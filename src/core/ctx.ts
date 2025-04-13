import {Context, Options, ResolveConfig, MultiOptions} from "../index";
import {
  deployCommandEndSymbol,
  getBuildOutDir,
  getConfig,
  getPackageManager,
  getPrivateKey,
  isMulti,
  localExecCommands,
  mergeMode,
  remoteExecCommands,
} from "./utils";
import defu from "defu";
import { consola } from 'consola';
import chalk from "chalk";
import { sep } from "node:path";
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
      shell: true,
      uploadBefore: [],
      uploadAfter: [],
      deployBefore: [],
      deployAfter: [],
    },
    maxConcurrent: 5,
    defaultBuild: true,
    readyTimeout: 2000,
    strictVendor: true,
    keepaliveInterval: 0,
    keepaliveCountMax: 3,
    forceIPv4: false,
    forceIPv6: false,
    bastion: {
      enabled: false,
      listen: {
        ip: '127.0.0.1',
        port: 12345
      },
      username: 'root',
      port: 22,
      readyTimeout: 2000,
      strictVendor: true,
      keepaliveInterval: 0,
      keepaliveCountMax: 3,
      forceIPv4: false,
      forceIPv6: false,
    }
  }

  function getDefaultCommand(options: Options): Options {
    return {
      commend: {
        uploadBefore: options.defaultBuild ? [`${getPackageManager()} run build`] : [],
        deployBefore: [`echo "${deployCommandEndSymbol}"\n`],
        deployAfter: [`echo "${deployCommandEndSymbol}"\n`],
      },
      target: options.target || `~\\${options.uploadPath}`,
    };
  }

  for (const configKey in _config) {
    if (configKey === 'mode') continue;

    const _options = _config[configKey] || {};
    let _rawOptions = configKey in _rawConfig ? _rawConfig[configKey] : {};
    const uploadDir = _rawOptions.uploadPath || _options.uploadPath || 'dist';
    const privateKeyPath = _rawOptions.privateKey || _options.privateKey;
    const bastionPrivateKeyPath = _rawOptions.bastion?.privateKey || _options.bastion?.privateKey;
    const outDir = getBuildOutDir(uploadDir);
    const currentMergeOption = { ..._rawOptions, ..._options };

    mergeOptions[configKey] = defu({
      uploadPath: outDir,
      privateKey: getPrivateKey(privateKeyPath),
      bastion: {
        privateKey: getPrivateKey(bastionPrivateKeyPath),
      }
    }, defu(currentMergeOption, getDefaultCommand(defu(currentMergeOption, _defaultOption)), _defaultOption));
  }

  for (const configKey in _rawConfig) {
    if (configKey === 'mode' || configKey in mergeOptions) continue;

    const _options = _rawConfig[configKey] || {};
    const uploadDir = _options.uploadPath || 'dist';
    const outDir = getBuildOutDir(uploadDir);

    mergeOptions[configKey] = defu({
      uploadPath: outDir,
      privateKey: getPrivateKey(_options.privateKey),
      bastion: {
        privateKey: getPrivateKey(_options.bastion?.privateKey),
      }
    }, defu(_options, getDefaultCommand(defu(_options, _defaultOption)), _defaultOption));
  }

  async function selectExecute(modes: string[], msg: string) {
    const selectOptions: { label: string, value: string, hint: string }[] = [];
    for (const mode of modes) {
      const option = mergeOptions[mode];
      selectOptions.push({
        label: mode,
        value: mode,
        hint: `${option.username}@${option.host}:${option.port}`,
      })
    }
    const modeValue = await consola.prompt(msg, {
      type: 'select',
      initial: selectOptions[0].value,
      options: selectOptions,
    });
    await executeToMode(modeValue);
  }

  function getUnregisteredModes(): string[] {
    const unregistered: string[] = [];
    for (const key in mergeOptions) {
      if (key === 'mode') continue;
      if (typeof mergeOptions[key] === 'object' && mergeOptions[key].host) {
        unregistered.push(key);
      }
    }
    return unregistered;
  }

  async function execute(): Promise<void> {
    const modes = mergeOptions.mode as string[];
    if (modes.length > 1) {
      const result = await consola.prompt(`There are currently multiple upload mode：${chalk.blueBright(`[${modes.join(',')}]`)}, Are you sure you want to upload all of them? `, {
        type: 'confirm',
      });
      if (!result) {
        await selectExecute(modes, 'There are multiple `mode` available. Please select one to execute.');
        process.exit(0);
        return await Promise.resolve();
      }
    }
    for (const mode of modes) {
      if (mode in mergeOptions) {
        await executeToMode(mode);
      } else {
        const unregisteredModes = getUnregisteredModes();
        await selectExecute(unregisteredModes, `\`${mode}\` mode not found，Please select the mode to execute.`);
      }
    }
    process.exit(0);
  }

  async function executeToMode(mode: string = 'default'): Promise<void> {
    return new Promise<void>(async (resolve) => {
      const options = mergeOptions[mode];
      const { host, commend, uploadPath } = options;

      const { uploadBefore, deployBefore, uploadAfter, deployAfter} = commend;

      // 执行上传前的命令
      await localExecCommands(uploadBefore, commend.shell);

      const { getConnection, uploadDirectory } = remoteUploadFile();

      const { targetConn, middleConn } = await getConnection(options);

      const modes = mergeOptions.mode as string[];
      const finishPrefix = `${chalk.blueBright(`[${mode}] ${modes.length > 1 ? host + ' ' : ''}`)}`;

      targetConn.on('ready', async () => {

        // 执行部署前的命令
        await remoteExecCommands(targetConn, deployBefore, commend.shell);

        const uploadDir = uploadPath.substring(uploadPath.lastIndexOf(sep) + 1);
        consola.log(`\n${chalk.hex('#c792e9')('◐')} ${chalk.greenBright(`Uploading ${finishPrefix}${uploadDir}...`)}\n`);

        uploadDirectory(targetConn, options).then(async () => {
          // 执行部署后的命令
          await remoteExecCommands(targetConn, deployAfter, commend.shell);
        }).finally(() => {
          targetConn.end();
        });
      }).on('close', async () => {
        // 执行上传后的命令
        await localExecCommands(uploadAfter, commend.shell);
        consola.log(`\n🎉 ${chalk.greenBright(`${finishPrefix}auto deploy complete!\n`)}`);
        targetConn.end();
        const { enabled } = options.bastion;
        if (enabled) {
          middleConn.end();
        }
        resolve();
      });
    });
  }

  return {
    execute,
  } as Context
}
