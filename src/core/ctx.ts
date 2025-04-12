import {Context, Options, ResolveConfig, MultiOptions} from "../index";
import {
  getBuildOutDir,
  getConfig,
  getPackageManager,
  isMulti,
  localExecCommands, mergeMode,
  remoteExecCommands,
} from "./utils";
import defu from "defu";
import { consola } from 'consola';
import { Client } from 'ssh2';
import chalk from "chalk";
import path from "node:path";
import {remoteUploadFile} from "./upload";

export async function createContext(rawOptions?: ResolveConfig): Promise<Context> {
  const { config } = await getConfig<ResolveConfig>();

  let _config: MultiOptions = !isMulti(config) ? { default: defu(config as Options) } : config as MultiOptions;
  let _rawConfig: MultiOptions = !isMulti(rawOptions) ? { default: defu(rawOptions as Options) } : rawOptions as MultiOptions;
  const mode = mergeMode(_rawConfig, _config);
  let mergeOptions = { mode } as MultiOptions;

  const _defaultOption: Options = {
    username: 'root',
    port: 22,
    commend: {
      uploadBefore: [],
      uploadAfter: [],
      deployBefore: [],
      deployAfter: [],
    },
    maxConcurrent: 5,
    defaultBuild: true,
  }

  function getDefaultCommand(options: Options): Options {
    return {
      commend: {
        uploadBefore: options.defaultBuild ? [`${getPackageManager()} run build`] : [],
      },
      target: options.target || `~\\${options.uploadPath}`,
    };
  }

  for (const configKey in _config) {
    if (configKey === 'mode') continue;

    const _options = _config[configKey] || {};
    let _rawOptions = configKey in _rawConfig ? _rawConfig[configKey] : {};
    const uploadDir = _rawOptions.uploadPath || _options.uploadPath || 'dist';
    const outDir = getBuildOutDir(uploadDir);

    mergeOptions[configKey] = defu({
      uploadPath: outDir,
    }, defu(_rawOptions, _options, getDefaultCommand(defu(_rawOptions, _options, _defaultOption)), _defaultOption));
  }

  for (const configKey in _rawConfig) {
    if (configKey === 'mode' || configKey in mergeOptions) continue;

    const _options = _rawConfig[configKey] || {};
    const uploadDir = _options.uploadPath || 'dist';
    const outDir = getBuildOutDir(uploadDir);

    mergeOptions[configKey] = defu({
      uploadPath: outDir,
      target: `~\\${uploadDir}`,
    }, defu(_options, getDefaultCommand(defu(_options, _defaultOption)), _defaultOption));
  }

  async function selectExecute(modes: string[], msg: string) {
    const selectOptions: { label: string, value: string, hint: string }[] = [];
    for (const mode of modes) {
      const option = mergeOptions[mode];
      selectOptions.push({
        label: mode,
        value: mode,
        hint: `${option.username}@${option.ip}:${option.port}`,
      })
    }
    const modeValue = await consola.prompt(msg, {
      type: 'select',
      initial: selectOptions[0].value,
      options: selectOptions,
    });
    await executeToMode(modeValue);
  }

  async function execute(): Promise<void> {
    const modes = mergeOptions.mode as string[];
    if (modes.length > 1) {
      const result = await consola.prompt('There are currently multiple upload \`mode\`, Are you sure you want to upload all of them?', {
        type: 'confirm',
      });
      if (!result) {
        await selectExecute(modes, 'There are multiple `mode` available. Please select one to execute.');
        return await Promise.resolve();
      }
    }
    for (const mode of modes) {
      if (mode in mergeOptions) {
        await executeToMode(mode);
      } else {
        await selectExecute(modes, `\`${mode}\` mode not found，Please select the mode to execute.`);
      }
    }
  }

  async function executeToMode(mode: string = 'default'): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      const {
        username,
        port,
        password,
        ip,
        commend,
        uploadPath,
        target,
        maxConcurrent
      } = mergeOptions[mode];
      const conn = new Client();

      const { uploadBefore, deployBefore, uploadAfter, deployAfter} = commend;

      // 执行上传前的命令
      await localExecCommands(uploadBefore);

      conn.on('ready', async () => {

        // 执行部署前的命令
        await remoteExecCommands(conn, deployBefore);

        const uploadDir = uploadPath.substring(uploadPath.lastIndexOf(path.sep) + 1);
        consola.log(`\n${chalk.hex('#c792e9')('◐')} ${chalk.greenBright(`Uploading ${uploadDir}...`)}\n`);

        const { uploadDirectory } = remoteUploadFile();

        uploadDirectory(conn, uploadPath, target, maxConcurrent).then(async () => {
          // 执行部署后的命令
          await remoteExecCommands(conn, deployAfter);
        }).finally(() => {
          conn.end();
        });
      }).on('error', (err) => {
        consola.error('SSH connection error:', err);
        reject(err);
        conn.end();
      }).on('close', async () => {
        // 执行上传后的命令
        await localExecCommands(uploadAfter);
        process.stdout.write('\n');
        consola.log(`🎉 ${chalk.greenBright('auto deploy complete!')}`)
        resolve();
        process.exit(0);
      }).connect({
        host: ip,
        port,
        username,
        password,
      });
    });
  }

  return {
    execute,
  } as Context
}
