import { enablePatches, produceWithPatches, type Patch } from 'immer'
import type { Project } from '../domain/model/types'
import type { Command, CommandHandler, CommandType } from './types'

// Immer 的 patch 能力需显式开启，且必须在任何 produceWithPatches 之前
enablePatches()

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

export interface ExecutionResult {
  project: Project
  patches: Patch[]
  inversePatches: Patch[]
}

/**
 * 应用一条命令，返回新的 Project 与该次变更的正/逆向 patch。
 *
 * 逆向 patch 是撤销栈的数据来源 —— undo 时把它应用到当前 Project 即可回滚。
 * handler 抛异常时异常会向外传播，draft 被丢弃，原 Project 不受影响。
 */
export function execute(project: Project, command: Command): ExecutionResult {
  const handler = getHandler(command.type)
  const [next, patches, inversePatches] = produceWithPatches(project, (draft) => {
    handler(draft, command.payload)
  })
  return { project: next, patches, inversePatches }
}

/** 仅供测试：清空注册表 */
export function __resetRegistryForTests(): void {
  handlers = new Map()
}
