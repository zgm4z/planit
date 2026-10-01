import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
// 用 Node 的 URL 而非全局 URL：测试跑在 jsdom 环境里，jsdom 会替换全局 `URL`，
// 它会把 `file://` 基准解析成 `http://localhost:3000/...`，导致 fileURLToPath 报
// 「The URL must be of scheme file」。
import { URL as NodeURL, fileURLToPath } from 'node:url'

/**
 * 守卫测试：`src/ui` 的**包间依赖方向**不得漂移。
 *
 * ## 这条规则为什么存在
 *
 * 本项目在 v0.2 就栽过「同一条规则两份实现」（`reconcileKind` 与
 * `migrateTaskV1ToV2` 各写一份，改一处另一处静默过期）。`src/ui` 按功能分包后，
 * 同一种病换了个形态复发：**被两个以上包用到的纯逻辑，被留在了某个功能包里**，
 * 于是别的包反过来 import 它，依赖图出现反向边。
 *
 * 已经栽过两次（都在本次重构中被纠正）：
 *   - 断点常量 1100 / 900 错放在 `outline/outlineColumns.ts` → `shared` 反向依赖 `outline`；
 *   - `canIndent/canOutdent`、`createResourceAndGetId` 错放在 `outline` / `inspector`
 *     → `shell/MenuBar` 反向依赖它们。
 * 这类错误的代价是双份真相：调用方一多，规则就会在某一处被改、另一处被漏。
 *
 * ## 目标依赖图（无环、单向）
 *
 *     views ──→ { gantt, outline, inspector, shell } ──→ shared
 *
 * 即：
 *   1. `shared` 不依赖任何兄弟包（它对内零依赖）；
 *   2. 四个功能包（gantt / outline / inspector / shell）彼此不互相依赖，只依赖 `shared`；
 *   3. `views` 是组装层，可以依赖全部。
 *
 * `../styles/` 是 SCSS 资源目录，**不是代码包**，任何包都可以 import，一律放行。
 *
 * 判据一句话：**被两个以上包用到的纯逻辑，属于 `shared/`。** 当你看到本测试变红，
 * 正确的修法通常不是给规则开例外，而是把那块共享逻辑下沉到 `shared/`，再从各包 import。
 */

/** `src/ui/` 的绝对路径（本测试与 App.tsx 同级） */
const UI_DIR = fileURLToPath(new NodeURL('.', import.meta.url))
/** `src/` 的绝对路径 —— 只用于把报错里的文件路径写成 `ui/…` 的短形式 */
const SRC_DIR = join(UI_DIR, '..')

/** 代码包（目录名）。`styles` 不在其中 —— 它是 SCSS，不是代码包。 */
const CODE_PACKAGES = new Set(['shared', 'gantt', 'outline', 'inspector', 'shell', 'views'])
/** 功能包：只允许依赖 `shared`。 */
const FEATURE_PACKAGES = new Set(['gantt', 'outline', 'inspector', 'shell'])
/** SCSS 资源目录 —— 任何包都可 import，放行。 */
const STYLES_DIR = 'styles'

/** 捕获 `from '…'` / `import '…'` / `export … from '…'` 的模块说明符 */
const IMPORT_RE = /(?:from|import)\s+['"]([^'"]+)['"]/g
/** 跨包 import 的形状：恰好一个 `../`，后接包名。`../../…`（出 ui）与 `./…`（同包）都不匹配 */
const CROSS_PACKAGE_RE = /^\.\.\/([a-z]+)(?:\/|$)/

interface CrossPackageImport {
  /** 相对 `src/` 的路径，如 `ui/shared/useBreakpoints.ts` */
  file: string
  line: number
  specifier: string
  fromPackage: string
  toPackage: string
}

/** 递归收集某个目录下的 `.ts` / `.tsx` 源文件（**排除 `.test.`**） */
function listSourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
      found.push(full)
    }
  }
  return found
}

/** 解析 `src/ui` 下所有源文件的跨包 import（同包 `./…`、出 ui 的 `../../…` 都不算） */
function collectCrossPackageImports(): { imports: CrossPackageImport[]; fileCount: number } {
  const files = listSourceFiles(UI_DIR)
  const imports: CrossPackageImport[] = []

  for (const file of files) {
    // 归属包 = `src/ui/` 之后的第一段目录名；直接躺在 `src/ui` 下的文件（App.tsx）不属于任何包
    const relativeToUi = relative(UI_DIR, file)
    const fromPackage = relativeToUi.split(/[/\\]/)[0]
    if (!CODE_PACKAGES.has(fromPackage)) continue

    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, index) => {
      for (const match of text.matchAll(IMPORT_RE)) {
        const specifier = match[1]
        const cross = specifier.match(CROSS_PACKAGE_RE)
        if (!cross) continue
        imports.push({
          file: relative(SRC_DIR, file),
          line: index + 1,
          specifier,
          fromPackage,
          toPackage: cross[1],
        })
      }
    })
  }

  return { imports, fileCount: files.length }
}

/** 违反目标依赖图的边 → 可读的报错文案（空数组 = 合规） */
function findViolations(imports: CrossPackageImport[]): string[] {
  const violations: string[] = []

  for (const dep of imports) {
    // SCSS 资源目录不是代码包 —— 任何方向都放行
    if (dep.toPackage === STYLES_DIR) continue
    // 指向未知目录（理论上不会出现）忽略，避免误报
    if (!CODE_PACKAGES.has(dep.toPackage)) continue
    // views 是组装层，无限制
    if (dep.fromPackage === 'views') continue

    if (dep.fromPackage === 'shared') {
      violations.push(
        `${dep.file}:${dep.line} 从 '${dep.specifier}' 导入 —— shared 不得依赖兄弟包；` +
          `被两个以上包用到的逻辑应下沉到 shared/`,
      )
      continue
    }

    if (FEATURE_PACKAGES.has(dep.fromPackage) && dep.toPackage !== 'shared') {
      violations.push(
        `${dep.file}:${dep.line} 从 '${dep.specifier}' 导入 —— ${dep.fromPackage} 只允许依赖 shared/；` +
          `被两个以上包用到的逻辑应下沉到 shared/`,
      )
    }
  }

  return violations
}

describe('src/ui 包间依赖方向', () => {
  const { imports, fileCount } = collectCrossPackageImports()

  it('扫到了足够多的源文件（防止遍历写错导致空扫、断言空转全绿）', () => {
    expect(fileCount).toBeGreaterThan(20)
  })

  it('提取器确实识别出了跨包边（防止正则写错导致"零违反"的假绿）', () => {
    // 已知真实存在的合法边：views → shell / outline / gantt / inspector / shared，
    // 且四个功能包都 → shared。一条都没提取到，说明解析逻辑坏了，不是代码合规。
    const edges = new Set(imports.map((d) => `${d.fromPackage}->${d.toPackage}`))
    expect(edges.has('shared->shared')).toBe(false)
    expect(edges.has('views->shell')).toBe(true)
    expect(edges.has('outline->shared')).toBe(true)
    expect(imports.length).toBeGreaterThan(5)
  })

  it('符合目标依赖图：shared 零内部依赖；功能包只依赖 shared；views 无限制', () => {
    // 失败时会打印每一条越界边及其修复指引，直接照抄即可。
    expect(findViolations(imports)).toEqual([])
  })
})
