import {UploadSpeedCalc} from "./speedCalc";
import { readdirSync, createReadStream } from "node:fs";
import chalk from "chalk";
import { resolve as pathResolve, sep } from "path";
import {flattenPathMapping, slash, taskExecute} from "./utils";
import {Options} from "../index";
import {consola} from "consola";
import { Client } from 'ssh2';
import { omit } from "lodash-es";

export type Clients = { targetConn: Client, middleConn?: Client }
const bastionHostOmit = ['target', 'uploadPath', 'commend', 'maxConcurrent', 'defaultBuild', 'bastion'];

export function remoteUploadFile() {

  let uploadStartTime = 0;
  let uploadEndTime = 0;
  let uploadFiles = 0;
  let uploadTotalSize = 0;

  const { start, update, getAverageSpeed, formatSpeed, getRecentAverageSpeed } = UploadSpeedCalc();

  async function uploadDirectory(conn, options: Options): Promise<void> {
    const { uploadPath, target, maxConcurrent } = options;
    const sftp = await new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
    });

    // 读取本地目录内容
    const items = readdirSync(uploadPath);

    // 获取本地和服务器的文件地址映射
    const mappings = flattenPathMapping(items, uploadPath, target);
    const remotePaths: Set<string> = new Set(Array.from(mappings.values()).map(item => item.substring(0, item.lastIndexOf("/"))));
    remotePaths.delete(target.endsWith("/") ? target.substring(0, target.length - 1) : target);

    for (let remotePath of remotePaths) {
      await ensureRemoteDir(sftp, remotePath);
    }

    // 上传文件
    const tasks: (() => Promise<void>)[] = [];
    mappings.forEach((value, key) => tasks.push(() => uploadFile(sftp, key, value)));
    uploadStartTime = performance.now();
    process.stdout.write('\n');
    const interval = setInterval(() => {
      const uploadState = updateUploadState();
      process.stdout.write(`\x1B[2K\r${uploadState}`);
    }, 100);
    try {
      await executeBatchUpload(tasks, maxConcurrent);
    } finally {
      clearInterval(interval);
    }
    process.stdout.write('\n');
  }

  async function getConnection(options: Options): Promise<Clients> {
    if (options.bastion?.enabled) {
      return getForwardOutConn(options);
    } else {
      return getDefaultConn(options);
    }
  }

  async function getDefaultConn(options: Options): Promise<Clients> {
    const conn = new Client();
    await conn.on('error', (err) => {
      consola.error('SSH connection error:', err);
      Promise.reject(err);
      conn.end();
    }).connect(omit(options, bastionHostOmit));
    return { targetConn: conn };
  }

  async function getForwardOutConn(options: Options): Promise<Clients> {
    const middleConn = new Client();
    const targetConn = new Client();
    const {
      host,
      port,
      username,
      listen
    } = options.bastion;

    middleConn.on('ready', async () => {
      consola.log(`${chalk.greenBright(`√ Bastion host: ${chalk.blueBright(`[${username}@${host}:${port}]`)} connection success.`)}`);

      const passage = await new Promise((resolve, reject) => {
        middleConn.forwardOut(listen.ip, listen.port, options.host, options.port, (err, passage) => err ? reject(err) : resolve(passage));
      });

      await targetConn.connect({
        sock: passage,
        ...omit(options, [...bastionHostOmit, 'enable', 'listen', 'host', 'port']),
      });
    }).on('error', (err) => {
      consola.error('Bastion SSH connection error:', err);
      Promise.reject(err);
      middleConn.end();
    }).connect(omit(options.bastion, bastionHostOmit));
    return {
      middleConn,
      targetConn,
    };
  }

  async function executeBatchUpload(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
    start();
    await taskExecute(tasks, limit);
  }

  function updateUploadState(): string {
    const diff = ((Math.max(uploadEndTime - uploadStartTime, 0)) / 1000).toFixed(2);
    const files = `${chalk.blueBright('Files')}: ${chalk.greenBright(uploadFiles)}`;
    const totalSize = `${chalk.blueBright('TotalSize')}: ${chalk.greenBright(formatSpeed(uploadTotalSize))}`;
    const duration = `${chalk.blueBright('Duration')}: ${chalk.greenBright(`${diff}s`)}`;
    const AVGRate = `${chalk.blueBright('AVG Rate')}: ${chalk.greenBright(getAverageSpeed())}`;
    const rate = `${chalk.blueBright('Rate')}: ${chalk.greenBright(getRecentAverageSpeed(1))}`;
    return `${files}   ${totalSize}   ${duration}   ${AVGRate}   ${rate}`;
  }

  async function uploadFile(sftp, localPath: string, remotePath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(localPath);
      const writeStream = sftp.createWriteStream(remotePath);

      readStream.on('data', (chunk) => {
        update(chunk.length);
        uploadTotalSize += chunk.length;
        uploadEndTime = performance.now();
      });

      readStream.pipe(writeStream)
        .on('close', () => {
          const pathPrefix = pathResolve(process.cwd());
          const shortPath = slash(localPath.replace(pathPrefix + sep, ''));
          ++uploadFiles;
          const uploadState = updateUploadState();
          process.stdout.write(`\x1B[1F\x1B[0J\r${chalk.greenBright('√')} ${chalk.blue(shortPath)}\n\n${uploadState}`);
          resolve()
        })
        .on('error', reject);
    });
  }

  async function ensureRemoteDir(sftp, remoteDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.stat(remoteDir, (err) => {
        if (err && err.code === 2) {
          sftp.mkdir(remoteDir, { recursive: true }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        } else if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  return {
    getConnection,
    uploadDirectory,
    uploadFile,
    ensureRemoteDir,
  };
}
