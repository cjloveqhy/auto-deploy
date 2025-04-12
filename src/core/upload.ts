import {UploadSpeedCalc} from "./speedCalc";
import fs from "node:fs";
import chalk from "chalk";
import path from "path";
import {flattenPathMapping, slash} from "./utils";

export function remoteUploadFile() {

  let uploadStartTime = 0;
  let uploadEndTime = 0;
  let uploadFiles = 0;
  let uploadTotalSize = 0;

  const { start, update, getAverageSpeed, formatSpeed, getRecentAverageSpeed } = UploadSpeedCalc();

  async function uploadDirectory(conn, localDir: string, remoteDir: string, limit: number) {
    const sftp = await new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
    });

    // 读取本地目录内容
    const items = fs.readdirSync(localDir);

    // 获取本地和服务器的文件地址映射
    const mappings = flattenPathMapping(items, localDir, remoteDir);
    const remotePaths: Set<string> = new Set(Array.from(mappings.values()).map(item => item.substring(0, item.lastIndexOf("/"))));
    remotePaths.delete(remoteDir.endsWith("/") ? remoteDir.substring(0, remoteDir.length - 1) : remoteDir);

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
    }, 500);
    try {
      await executeBatchUpload(tasks, limit);
    } finally {
      clearInterval(interval);
    }
    process.stdout.write('\n');
  }

  async function executeBatchUpload(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
    const executing = new Set<Promise<any>>();

    start();

    for (const task of tasks) {
      if (executing.size >= limit) {
        await Promise.race(executing);
      }

      // 创建并执行新任务
      const p = task().then(() => executing.delete(p));

      executing.add(p);
    }

    // 等待所有剩余任务完成
    await Promise.all(executing);
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
      const readStream = fs.createReadStream(localPath);
      const writeStream = sftp.createWriteStream(remotePath);

      const fileStats = fs.statSync(localPath);
      const totalBytes = fileStats.size;

      readStream.on('data', (chunk) => {
        update(chunk.length);
      });

      readStream.pipe(writeStream)
        .on('close', () => {
          const pathPrefix = path.resolve(process.cwd());
          const shortPath = slash(localPath.replace(pathPrefix + path.sep, ''));
          uploadEndTime = performance.now();
          ++uploadFiles;
          uploadTotalSize += totalBytes;
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
    uploadDirectory,
    uploadFile,
    ensureRemoteDir,
  };
}
