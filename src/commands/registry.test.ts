import { describe, it, expect, beforeEach } from 'vitest'
import { createProject } from '../domain/model/factories'
import { registerHandler, getHandler, execute, resetRegistry } from './registry'
import type { Command } from './types'

describe('命令注册表', () => {
  beforeEach(() => resetRegistry())

  it('注册后能取出 handler', () => {
    const handler = () => {}
    registerHandler('project.rename', handler)
    expect(getHandler('project.rename')).toBe(handler)
  })

  it('未注册的命令类型抛出明确错误', () => {
    expect(() => getHandler('project.rename')).toThrow(/未注册/)
  })

  it('execute 应用 handler 并返回新 Project，原对象不被改动', () => {
    registerHandler('project.rename', (draft, payload: { name: string }) => {
      draft.name = payload.name
    })
    const before = createProject('旧名字', '2026-03-02')
    const command: Command = {
      type: 'project.rename',
      label: '重命名项目',
      payload: { name: '新名字' },
    }

    const after = execute(before, command)

    expect(after.name).toBe('新名字')
    expect(before.name).toBe('旧名字')
  })

  it('execute 不修改传入的 command 对象', () => {
    registerHandler('project.rename', (draft, payload: { name: string }) => {
      draft.name = payload.name
    })
    const command: Command = {
      type: 'project.rename',
      label: '重命名项目',
      payload: { name: '新名字' },
    }
    const snapshot = JSON.stringify(command)

    execute(createProject('X', '2026-03-02'), command)

    expect(JSON.stringify(command)).toBe(snapshot)
  })
})
