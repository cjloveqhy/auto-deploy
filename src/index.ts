export * from './core/ctx';

export interface Commands {
  /**
   * enable an interactive shell session
   * @defaultValue true
   */
  shell?: boolean
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

export interface BastionHostBase {
  /**
   * enable bastion host service
   * @defaultValue false
   */
  enabled?: boolean
  /**
   * bastion host listen config
   */
  listen?: {
    /**
     * bastion host local listen ip address
     * @defaultValue 127.0.0.1
     */
    ip?: string
    /**
     * bastion host local listen port
     * @defaultValue 12345
     */
    port?: number
  }
}

export type BastionHostOmit = 'target' | 'uploadPath' | 'commend' | 'maxConcurrent' | 'defaultBuild' | 'bastion';
export interface BastionHost extends Omit<Options, BastionHostOmit>, BastionHostBase {}

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
  /**
   * bastion host link info
   * @defaultValue { username: 'root' }
   */
  bastion?: BastionHost
  /**
   * How long (in milliseconds) to wait for the SSH handshake to complete.
   * @defaultValue 20000 (integer)
   */
  readyTimeout?: number
  /**
   * Performs a strict server vendor check before sending vendor-specific requests, etc. (e.g. check for OpenSSH server when using `openssh_noMoreSessions()`)
   * @defaultValue true
   */
  strictVendor?: boolean
  /**
   * How often (in milliseconds) to send SSH-level keepalive packets to the server (in a similar way as OpenSSH's ServerAliveInterval config option). Set to 0 to disable.
   * @defaultValue 0 (integer)
   */
  keepaliveInterval?: number
  /**
   * How many consecutive, unanswered SSH-level keepalive packets that can be sent to the server before disconnection (similar to OpenSSH's ServerAliveCountMax config option).
   * @defaultValue 3 (integer)
   */
  keepaliveCountMax?: number
  /**
   * Only connect via resolved IPv4 address for `host`.
   * @defaultValue false
   */
  forceIPv4?: boolean
  /**
   * Only connect via resolved IPv6 address for `host`.
   * @defaultValue false
   */
  forceIPv6?: boolean
}

export type MultiOptions = {
  mode?: string[] | string
} & Record<string, Options>

export type ResolveConfig = Options | MultiOptions

export interface Context {
  execute: (() => Promise<void>)
}

export const defineConfig = (config: ResolveConfig): ResolveConfig => config;
