export type Commands = {
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

export type Options = {
  /**
   * 服务器链接账号名
   */
  username?: string
  /**
   * 服务器链接密码
   */
  password?: string
  /**
   * ip地址
   */
  ip?: string
  /**
   * 服务器链接端口
   */
  port?: number
  /**
   * 上传至服务器文件路径
   */
  target?: string
  /**
   * 待上传文件路径
   */
  uploadPath?: string
  /**
   * 上传前后及部署前后的执行命令
   */
  commend?: Commands
}

export type Context = {
  execute: () => Promise<void>
}
export const defineConfig = (config: Options): Options => config;
