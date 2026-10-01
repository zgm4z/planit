import { produce } from 'immer'
import type { Project } from '../domain/model/types'
import type { Command, CommandHandler, CommandType } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = CommandHandler<any>

let handlers = new Map<CommandType, AnyHandler>()

export function registerHandler<P>(type: CommandType, handler: CommandHandler<P>): void {
  handlers.set(type, handler as AnyHandler)
}

export function getHandler(type: CommandType): AnyHandler {
  const handler = handlers.get(type)
  if (!handler) {
    throw new Error(`未注册的命令类型：${type}`)
  }
  return handler
}

/** 应用一条命令。返回新的 Project，原对象保持不变 */
export function execute(project: Project, command: Command): Project {
  const handler = getHandler(command.type)
  return produce(project, (draft) => {
    handler(draft, command.payload)
  })
}

/** 仅供测试：清空注册表 */
export function resetRegistry(): void {
  handlers = new Map()
}
