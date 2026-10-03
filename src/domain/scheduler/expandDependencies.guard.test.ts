import { readFileSync } from 'node:fs'
import { URL as NodeURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DependencyType } from '../model/types'
import { isPredecessorExpandable, isSuccessorExpandable } from './expandDependencies'

/**
 * 守卫：跨语言镜像的**摘要端点等价表**不得漂移。
 *
 * `scripts/omniplanParity.py`（生成 parity fixture 的纯 Python 工具）把
 * `expandDependencies.ts` 的 `isPredecessorExpandable` / `isSuccessorExpandable`
 * 镜像成了两个常量集合。两者一旦不一致就**静默缩水**：某个合格任务的「可展开性」
 * 翻转后，它会在下次生成时从 `qualifyingTaskIds` 消失，而 CI 仍绿 —— 因为
 * `parity.test.ts` 读的是**已提交的 fixture**（与先前「摘要依赖被静默丢弃」同一形状）。
 *
 * 这里**不 shell python3**（不让 `pnpm test` 依赖 Python 运行时），改为直接解析脚本
 * 源码里的两个常量集合，与 TS 侧**真实导出**的规则函数逐一比对。任一侧改动而另一侧
 * 未跟上，本测试即红。
 */
const SCRIPT_PATH = fileURLToPath(new NodeURL('../../../scripts/omniplanParity.py', import.meta.url))
const ALL_TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF']

/** 从 Python 源码里取出 `NAME = {'FS', 'FF'}` 形式的字符串集合。 */
function pythonSet(source: string, name: string): Set<string> {
  const match = new RegExp(`${name}\\s*=\\s*\\{([^}]*)\\}`).exec(source)
  if (!match) throw new Error(`scripts/omniplanParity.py 里找不到常量 ${name}`)
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]))
}

describe('等价表守卫：expandDependencies.ts ↔ scripts/omniplanParity.py', () => {
  const source = readFileSync(SCRIPT_PATH, 'utf8')

  it('「前置是摘要可精确展开」的类型集合两侧一致', () => {
    const ts = new Set(ALL_TYPES.filter((type) => isPredecessorExpandable(type)))
    expect(pythonSet(source, 'PREDECESSOR_EXPANDABLE')).toEqual(ts)
  })

  it('「后继是摘要可精确展开」的类型集合两侧一致', () => {
    const ts = new Set(ALL_TYPES.filter((type) => isSuccessorExpandable(type)))
    expect(pythonSet(source, 'SUCCESSOR_EXPANDABLE')).toEqual(ts)
  })

  it('解析到的集合非空（防正则失效导致守卫空转）', () => {
    expect(pythonSet(source, 'PREDECESSOR_EXPANDABLE').size).toBeGreaterThan(0)
    expect(pythonSet(source, 'SUCCESSOR_EXPANDABLE').size).toBeGreaterThan(0)
  })
})
