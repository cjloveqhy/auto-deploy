import * as path from "path";
import * as fs from "node:fs";
import { consola } from "consola";
import chalk from "chalk";
import {spawn} from "child_process";
import {ConfigLayerMeta, loadConfig, ResolvedConfig, UserInputConfig} from "c12";
import {UploadSpeedCalc} from "./speedCalc";

export async function getConfig<T extends UserInputConfig = UserInputConfig, MT extends ConfigLayerMeta = ConfigLayerMeta>(): Promise<ResolvedConfig<T, MT>> {
  const { config, ...resolvedConfig } = await loadConfig<T, MT>({ name: 'ssh' });
  if (!config || Object.keys(config).length === 0) {
    consola.error(`Configure in the project root path:\n${chalk.blue('ssh.config.ts')}\n${chalk.blue('ssh.config.js')}\n${chalk.blue('ssh.config.json')}\n${chalk.blue('ssh.config.mjs')}\n${chalk.blue('ssh.config.cjs')}`);
    return;
  }
  return { config, ...resolvedConfig };
}

export function slash(str) {
  return str.replace(/\\/g, "/");
}

export function getBuildOutDir(path: string): string | undefined {
  return getRootPath(path)
}

function getRootPath(...dir: string[]) {
  return path.resolve(process.cwd(), ...dir);
}

export function getPackageManager(): string {
  const managers = ['npm', 'yarn', 'pnpm', 'bun']
  const packageManager = process.env.npm_execpath;
  for (let manager of managers) {
    if (packageManager.includes(manager)) {
      return manager;
    }
  }
}

function flattenPathMapping(items: string[], localDir: string, remoteDir: string): Map<string, string> {
  return items.reduce<Map<string, string>>((acc, item) => {
    const localPath = path.join(localDir, item);
    const remotePath = path.join(remoteDir, item).replace(/\\/g, '/');
    const stats = fs.statSync(localPath);

    if (stats.isDirectory()) {
      const mappings = flattenPathMapping(fs.readdirSync(localPath), localPath, remotePath);
      mappings.forEach((value, key) => acc.set(key, value));
    } else {
      acc.set(localPath, remotePath);
    }
    return acc;
  }, new Map<string, string>());
}

let uploadStartTime = 0;
let uploadEndTime = 0;
let uploadFiles = 0;
let uploadTotalSize = 0;
const { start, update, getAverageSpeed, formatSpeed, getRecentAverageSpeed } = UploadSpeedCalc();

export async function uploadDirectory(conn, localDir: string, remoteDir: string, limit: number) {
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

export async function uploadFile(sftp, localPath, remotePath): Promise<void> {
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
        const shortPath = localPath.replace(pathPrefix + path.sep, '').replaceAll('\\', path.sep) as string;
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

export async function ensureRemoteDir(sftp, remoteDir): Promise<void> {
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

async function execWithLiveOutput(cmd): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`command failed with code ${code}`));
    });
  });
}

export async function localExecCommands(commands: string[] = []) {
  // 执行上传阶段的命令
  for (const cmd of commands) {
    consola.log(`> ${cmd}`)
    await execWithLiveOutput(cmd)
  }
}

async function execRemoteWithLiveOutput(conn, cmd: string) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) reject(err);
      stream.on('data', (data) => process.stdout.write(data))
        .stderr.on('data', (data) => process.stderr.write(data))
        .on('close', resolve);
    })
  })
}

export async function remoteExecCommands(conn, commands: string[] = []) {
  // 执行部署阶段的命令
  for (const cmd of commands) {
    await execRemoteWithLiveOutput(conn, cmd);
  }
}

export function createLoading(format: ((active: string, current: number) => string)) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let interval;
  let current = 0;

  return {
    start() {
      interval = setInterval(() => {
        process.stdout.write(format(frames[current], current));
        current = (current + 1) % frames.length;
      }, 10);
    },
    stop() {
      interval && clearInterval(interval);
    }
  };
}
