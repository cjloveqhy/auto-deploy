export * from './core/ctx';

export interface Commands {
  /**
   * 文件上传前执行脚本
   */
  uploadBefore?: string[]
  /**
   * 文件上传后执行脚本
   */
  uploadAfter?: string[]
  /**
   * 部署前执行脚本
   */
  deployBefore?: string[]
  /**
   * 部署后执行脚本
   */
  deployAfter?: string[]
}

export interface Options {
  /**
   * server link account name
   * @defaultValue root
   */
  username?: string
  /**
   * server link password
   */
  password?: string
  /**
   * server link private key
   */
  privateKey?: string | Buffer
  /**
   * server host
   */
  host?: string
  /**
   * server link port
   * @defaultValue 22
   */
  port?: number
  /**
   * file path to be uploaded to the server
   * @defaultValue ~/{@link uploadPath}
   */
  target?: string
  /**
   * path of the file to be uploaded
   * @defaultValue dist
   */
  uploadPath?: string
  /**
   * execute commands before and after upload and deployment
   */
  commend?: Commands
  /**
   * maximum number of files to be uploaded concurrently
   * @defaultValue 5
   */
  maxConcurrent?: number
  /**
   * whether to use the default packaging command. This command is enabled by default
   * @defaultValue true
   */
  defaultBuild?: boolean
}

export type MultiOptions = {
  mode?: string[] | string
} & Record<string, Options>

export type ResolveConfig = Options | MultiOptions

export interface Context {
  execute: (() => Promise<void>)
}

export const defineConfig = (config: ResolveConfig): ResolveConfig => config;
