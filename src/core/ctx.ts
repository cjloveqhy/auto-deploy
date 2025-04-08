import {Context, Options} from "../index";
import {
  getBuildOutDir,
  getConfig,
  getPackageManager,
  localExecCommands,
  remoteExecCommands,
  uploadDirectory
} from "./utils";
import defu from "defu";
import * as consola from 'consola';
import { Client } from 'ssh2';
import chalk from "chalk";
import * as path from "path";

export async function createContext(rawOptions?: Options): Promise<Context> {
  const { config } = await getConfig<Options>();
  const outDir = getBuildOutDir(rawOptions.uploadPath || config.uploadPath || 'dist');
  const defaultOption: Options = {
    username: 'root',
    port: 22,
    uploadPath: outDir,
    target: '~',
    commend: {
      uploadBefore: [`${getPackageManager()} run build`],
      uploadAfter: [],
      deployBefore: [],
      deployAfter: [],
    },
  }
  const mergeOptions = defu({ ...config && Object.keys(config).length > 0 ? config : rawOptions }, defaultOption)

  async function execute(): Promise<void> {
    const { username, port, password, ip, commend, uploadPath, target } = mergeOptions
    const conn = new Client();

    const { uploadBefore, deployBefore, uploadAfter, deployAfter} = commend

    // 执行上传前的命令
    await localExecCommands(uploadBefore);

    conn.on('ready', async () => {

      // 执行部署前的命令
      await remoteExecCommands(conn, deployBefore);

      const uploadDir = uploadPath.substring(uploadPath.lastIndexOf(path.sep) + 1);
      consola.log(`\n${chalk.hex('#c792e9')('◐')} ${chalk.greenBright(`Uploading ${uploadDir}...`)}\n`);

      uploadDirectory(conn, uploadPath, target).then(async () => {
        // 执行部署后的命令
        await remoteExecCommands(conn, deployAfter);
      }).finally(() => {
        conn.end();
      });
    }).on('error', (err) => {
      consola.error('SSH connection error:', err);
      conn.end();
    }).on('close', async () => {
      // 执行上传后的命令
      await localExecCommands(uploadAfter);
      process.stdout.write('\r\n');
      consola.log(`🎉 ${chalk.green('auto deploy complete!')}`)
      process.exit(0);
    }).connect({
      host: ip,
      port,
      username,
      password,
    });
  }

  return {
    execute,
  } as Context
}
