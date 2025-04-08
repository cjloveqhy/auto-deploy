import * as path from "path";
import * as fs from "node:fs";
import * as consola from "consola";
import chalk from "chalk";
import {spawn} from "child_process";
import {ConfigLayerMeta, loadConfig, ResolvedConfig, UserInputConfig} from "c12";

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

export async function uploadDirectory(conn, localDir, remoteDir) {
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });

  // 确保远程目录存在
  await ensureRemoteDir(sftp, remoteDir);

  // 读取本地目录内容
  const items = fs.readdirSync(localDir);

  for (const item of items) {
    const localPath = path.join(localDir, item);
    const remotePath = path.join(remoteDir, item).replace(/\\/g, '/');
    const stats = fs.statSync(localPath);

    if (stats.isDirectory()) {
      // 递归上传子目录
      await uploadDirectory(conn, localPath, remotePath);
    } else {
      // 上传文件
      await uploadFile(sftp, localPath, remotePath);
    }
  }
}

export async function uploadFile(sftp, localPath, remotePath): Promise<void> {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(localPath);
    const writeStream = sftp.createWriteStream(remotePath);

    const fileStats = fs.statSync(localPath);
    const totalBytes = fileStats.size;
    let uploadedBytes = 0;
    let loading = null;
    let progress = 0;

    readStream.on('data', (chunk) => {
      uploadedBytes += chunk.length;
      progress = Number(((uploadedBytes / totalBytes) * 100).toFixed(2));
      const pathPrefix = path.resolve(process.cwd());
      const shortPath = localPath.replace(pathPrefix + path.sep, '').replaceAll('\\', path.sep) as string;
      if (progress < 100) {
        if (!loading) {
          loading = createLoading((active) => chalk.blue(`\r${active} uploading ${shortPath} >> ${remotePath}: ${progress}%`))
          loading.start();
        }
      } else {
        loading && loading.stop();
        consola.success(`\r${chalk.blue(shortPath)}`);
      }
    });

    readStream.pipe(writeStream)
      .on('close', () => {
        resolve();
      })
      .on('error', (err) => {
        reject(err);
      });
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
