import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
// 用 Node 的 URL —— jsdom 会替换全局 `URL`，把 file:// 基准解析坏（见 packageDeps.test.ts 的说明）
import { URL as NodeURL, fileURLToPath } from 'node:url'

/**
 * 守卫测试：`src/` 里**不得**用 `<` / `>` 直接比较承载时刻的字段。
 *
 * 为什么：`DateStr` 与 `DateTimeStr` 都是 `string`，编译器拦不住混用，而混用是
 * **静默**错（`'…T09:00' < '…'` 为假、`parseDate` 得 NaN）。归一化只有一份实现
 * （`dateTime.ts` 的 `toDateStr`），本测试保证没人绕过它。
 *
 * 修好的写法天然不触发：`toDateStr(x.startDate) > y` 里字段名与运算符之间隔着 `)`。
 */

/** 承载时刻的字段名（spec §2.2 判为 `DateTimeStr` 者）。`scheduledStart` 等派生量不在内。 */
const MOMENT_FIELDS = [
  'startDate',
  'endDate',
  'statusDate',
  'availableFrom',
  'availableUntil',
  'scheduling\\.date',
]

/**
 * 字段可出现为 `resource.availableFrom` / `task.scheduling.date` 这样的**限定形式**，
 * 故字段名前允许一条可选的 `a.b.` 限定链。若不允许，`x < resource.availableFrom`
 * 这种「运算符在左、限定字段在右」的裸比较会漏网（`<` 与 `availableFrom` 之间隔着
 * `resource.`）—— 那正是本守卫要抓的方向之一。
 */
const QUALIFIER = '(?:[\\w$]+\\.)*'
const FIELD = `(?:${MOMENT_FIELDS.join('|')})`

/** 字段名紧邻比较运算符即算违规（字段名与运算符之间只允许空白） */
const VIOLATION_RE = new RegExp(
  `(?:${QUALIFIER}${FIELD})\\s*[<>]=?|[<>]=?\\s*(?:${QUALIFIER}${FIELD})`,
)

const CALENDAR_DIR = fileURLToPath(new NodeURL('.', import.meta.url))
const SRC_DIR = join(CALENDAR_DIR, '..', '..')

/** 本模块自身（它当然要比较）与日期工具豁免 */
const EXEMPT = new Set(['calendar/dateTime.ts', 'dateUtils.ts'])

function listSourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...listSourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) found.push(full)
  }
  return found
}

/** 纯函数：给一段源码，回违规行（供自测用，避免往 src 里塞真违规） */
export function findViolations(relativePath: string, text: string): string[] {
  if (EXEMPT.has(relativePath)) return []
  const hits: string[] = []
  text.split('\n').forEach((line, index) => {
    if (VIOLATION_RE.test(line)) hits.push(`${relativePath}:${index + 1}: ${line.trim()}`)
  })
  return hits
}

describe('dateTime 守卫：承载时刻的字段不得裸比较', () => {
  const files = listSourceFiles(SRC_DIR)

  it('扫到了足够多的源文件（防止遍历写错导致空扫全绿）', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('守卫自测：「字段名 > x」与「x < 字段名」都能被抓到（防止正则写错导致假绿）', () => {
    expect(findViolations('a.ts', 'if (project.startDate > x) {}')).toHaveLength(1)
    expect(findViolations('a.ts', 'if (x < resource.availableFrom) {}')).toHaveLength(1)
    // 修好的写法（包了 toDateStr）不算违规
    expect(findViolations('a.ts', 'if (toDateStr(project.startDate) > x) {}')).toHaveLength(0)
    // 派生量不在清单里
    expect(findViolations('a.ts', 'if (schedule.scheduledStart < acc) {}')).toHaveLength(0)
  })

  it('src/ 里没有裸比较承载时刻字段的地方', () => {
    const violations = files.flatMap((file) =>
      findViolations(relative(SRC_DIR, file).split('\\').join('/'), readFileSync(file, 'utf8')),
    )
    expect(violations).toEqual([])
  })
})
