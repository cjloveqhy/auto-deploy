import * as path from "path";
import * as fs from "node:fs";
import { consola } from "consola";
import chalk from "chalk";
import {spawn} from "child_process";
import {ConfigLayerMeta, loadConfig, ResolvedConfig, UserInputConfig} from "c12";
import {MultiOptions, ResolveConfig} from "../index";

export async function getConfig<T extends UserInputConfig = UserInputConfig, MT extends ConfigLayerMeta = ConfigLayerMeta>(): Promise<ResolvedConfig<T, MT>> {
  const { config, ...resolvedConfig } = await loadConfig<T, MT>({ name: 'ssh' });
  if (!config || Object.keys(config).length === 0) {
    consola.error(`Configure in the project root path:\n${chalk.blue('ssh.config.ts')}\n${chalk.blue('ssh.config.js')}\n${chalk.blue('ssh.config.json')}\n${chalk.blue('ssh.config.mjs')}\n${chalk.blue('ssh.config.cjs')}`);
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
  return 'mode' in config || Object.keys(config).some(key => !['commend'].includes(key) && typeof config[key] === 'object');
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

async function execWithLiveOutput(cmd): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject();
    }).on('error', (err) => {
      reject(new Error(err));
    });
  });
}

export async function localExecCommands(commands: string[] = []): Promise<void> {
  // 执行上传阶段的命令
  for (const cmd of commands) {
    consola.log(`> ${cmd}`)
    await execWithLiveOutput(cmd);
  }
}

async function execRemoteWithLiveOutput(conn, cmd: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) reject(err);
      stream.on('data', (data) => process.stdout.write(data))
        .stderr.on('data', (data) => process.stderr.write(data))
        .on('close', resolve);
    })
  })
}

export async function remoteExecCommands(conn, commands: string[] = []): Promise<void> {
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
