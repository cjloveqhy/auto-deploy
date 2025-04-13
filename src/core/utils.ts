import * as path from "path";
import * as fs from "node:fs";
import {consola} from "consola";
import chalk from "chalk";
import {spawn} from "child_process";
import {ConfigLayerMeta, loadConfig, ResolvedConfig, UserInputConfig} from "c12";
import {MultiOptions, ResolveConfig} from "../index";

const configName = 'auto-deploy';
export const deployCommandEndSymbol = '__HAPPYC__AUTO__DEPLOY__END__';
export async function getConfig<T extends UserInputConfig = UserInputConfig, MT extends ConfigLayerMeta = ConfigLayerMeta>(): Promise<ResolvedConfig<T, MT>> {
  const { config, ...resolvedConfig } = await loadConfig<T, MT>({ name: configName });
  if (!config || Object.keys(config).length === 0) {
    consola.error(`Configure in the project root path:\n${chalk.blue(`${configName}.config.ts`)}\n${chalk.blue(`${configName}.config.js`)}\n${chalk.blue(`${configName}.config.json`)}\n${chalk.blue(`${configName}.config.mjs`)}\n${chalk.blue(`${configName}.config.cjs`)}`);
    return;
  }
  return { config, ...resolvedConfig };
}

export function slash(str): string {
  return str.replace(/\\/g, "/");
}

export function getBuildOutDir(path: string): string | undefined {
  return getRootPath(path)
}

function getRootPath(...dir: string[]): string {
  return path.resolve(process.cwd(), ...dir);
}

export function getPrivateKey(path: string | Buffer): Buffer {
  return typeof path === 'string' ? fs.readFileSync(path) : path;
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

export function flattenPathMapping(items: string[], localDir: string, remoteDir: string): Map<string, string> {
  return items.reduce<Map<string, string>>((acc, item) => {
    const localPath = path.join(localDir, item);
    const remotePath = slash(path.join(remoteDir, item));
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

export function isMulti(config: ResolveConfig): boolean {
  return 'mode' in config || Object.keys(config).some(key => !['commend', 'bastion', 'privateKey'].includes(key) && typeof config[key] === 'object');
}

export function getMode(config: MultiOptions): string[] {
  const _mode: string[] = [];
  if (config.mode) {
    _mode.push(...typeof config.mode === 'string' ? [config.mode] : config.mode);
  }
  return _mode;
}

export function mergeMode(...configs: MultiOptions[]): string[] {
  const mode: string[][] = [];
  configs.forEach(config => mode.push(getMode(config)));
  const _mode = mode.reduce((acc, current) => {
    for (const value of current) {
      if (!acc.includes(value)) {
        acc.push(value);
      }
    }
    return acc;
  }, []);
  if (_mode.length === 0) _mode.push('default');
  return _mode;
}

async function execWithLiveOutput(cmd: string, shell: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      stdio: 'inherit',
      shell
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject();
    }).on('error', (err) => reject(err));
  });
}

export async function localExecCommands(commands: string[] = [], shell: boolean): Promise<void> {
  // 执行上传阶段的命令
  for (const cmd of commands) {
    consola.log(`> ${cmd}`)
    await execWithLiveOutput(cmd, shell);
  }
}

async function execRemoteWithLiveOutput(conn, cmd: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) reject(err);
      stream.on('data', (data) => process.stdout.write(data))
        .stderr.on('data', (data) => process.stderr.write(data))
        .on('close', resolve);
    });
  });
}

async function shellExecRemoteWithLiveOutput(conn, commands: string[] = []): Promise<void> {
  const stream = await new Promise((resolve, reject) => {
    conn.shell((err, stream) => err ? reject(err) : resolve(stream));
  });
  let currentCommandIndex = 0;

  function sendNextCommand(stream) {
    if (currentCommandIndex < commands.length) {
      const cmd = commands[currentCommandIndex] + '\n';
      stream.write(cmd);
      currentCommandIndex++;
    }
  }
  process.stdout.write('\n');
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (data) => {
      const result = data.toString();
      if (['error', 'command not found'].includes(result)) {
        process.stderr.write(data);
        reject();
      } else {
        if ((currentCommandIndex > 1 && currentCommandIndex <= commands.length)) {
          if (!result.includes(deployCommandEndSymbol)) {
            process.stdout.write(data);
          }
        }
        sendNextCommand(stream);
        if (currentCommandIndex === commands.length && result.includes(deployCommandEndSymbol)) {
          resolve();
        }
      }
    });

    sendNextCommand(stream);
  });
  process.stdout.write('\n');
}

// 执行部署阶段的命令
export async function remoteExecCommands(conn, commands: string[] = [], shell: boolean): Promise<void> {
  if (commands.length === 1 && commands[0].includes(deployCommandEndSymbol)) {
    return Promise.resolve();
  }
  if (shell) {
    await shellExecRemoteWithLiveOutput(conn, commands);
  } else {
    for (const cmd of commands) {
      await execRemoteWithLiveOutput(conn, cmd);
    }
  }
}

export async function taskExecute(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  const executing = new Set<Promise<any>>();

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
