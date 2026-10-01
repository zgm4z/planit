/**
 * 数字与日期的**唯一格式化实现**（设计规范 §1.3）。
 *
 * 为什么必须集中在一处：本项目反复吃过「同一规则、两处实现」的亏 —— 四位小数
 * 一度同时出现在右栏与大纲列，两处各自四舍五入，改一处另一处静默漂移。右栏
 * （Inspector / ProjectInspector / ResourceInspector）与大纲列（OutlineTree）
 * 一律从这里取格式，**任何组件内不得再写 toFixed / toLocaleString / Math.round(x*100)/100**。
 *
 * 本模块**刻意不依赖 i18n**（与 outlineColumns 的分层一致）：数字部分的格式与语言
 * 无关，量纲单位（「天」「人日」「%」）由渲染层用 i18next 拼接。这样单测不必初始化语言。
 *
 * 返回值里的 `null` 是**语义**，不是「空串」：它表示**算不出来**（§3.3 的中间那类），
 * 由渲染层统一显示为弱化的 `—`。**真的是 0** 返回 `'0'`，**无此概念**则由调用方
 * 干脆不渲染这一行 —— 三种「空」因此可分辨（见 InspectorFields 的 StatRow）。
 */

/** 按位数四舍五入；非有限值（NaN / Infinity）一律当「算不出来」 */
function round(value: number, digits: number): number | null {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  // 加 EPSILON 修正二进制误差：0.15 * 10 = 1.4999999999999998 → 否则会被截成 1.4
  const shifted = (value + Number.EPSILON * Math.sign(value)) * factor
  return Math.round(shifted) / factor
}

/**
 * 定点小数字符串，**不加千分位**。**取整值不加 `.0`**（§1.3：「0.9」保留一位，
 * 「1」「5」不带小数点）。
 *
 * 这是本模块所有数字格式的**唯一内核**：下面的 formatEffort / formatDays / … 只是
 * 它绑定不同量纲的别名，formatCost 再加一层千分位。可编辑输入框的「失焦归一」
 * （§6）也用它 —— 编造成本的输入框里出现 `1,234` 会让光标与退格变得别扭。
 */
export function formatPlain(value: number, digits: number): string | null {
  const rounded = round(value, digits)
  if (rounded === null) return null
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits)
}


/** 千分位分组。手写而不走 `toLocaleString`：后者的分组符号随运行环境的 locale 变，单测会飘 */
function groupThousands(value: number): string {
  const sign = value < 0 ? '-' : ''
  const [intPart, fracPart] = String(Math.abs(value)).split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fracPart ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`
}

/**
 * 工作量（人·日）：**1 位**小数（§1.3）。`0.8889 → '0.9'`，`3 → '3'`。
 * 引擎派生的投入 / 剩余都走它 —— 这是「四位小数永不出现」的唯一保证点。
 */
export function formatEffort(value: number): string | null {
  return formatPlain(value, 1)
}

/**
 * 工期 / 浮时（工作日）：**0 位**（§1.3）。单位「天」由调用方用 i18n 拼接。
 */
export function formatDays(value: number): string | null {
  return formatPlain(value, 0)
}

/** 百分比：**0 位**（§1.3），不含 `%`（渲染层拼） */
export function formatPercent(value: number): string | null {
  return formatPlain(value, 0)
}

/**
 * 小时数（资源面板的派生总计）：与工作量同为 1 位小数的量纲。
 * 复用的不是「投入」这个名字，而是同一条「小数位按量纲固定」的规则。
 */
export function formatHours(value: number): string | null {
  return formatPlain(value, 1)
}

/** 成本（元）：**0 位 + 千分位**（§1.3）。`1234.5 → '1,235'` */
export function formatCost(value: number): string | null {
  const rounded = round(value, 0)
  return rounded === null ? null : groupThousands(rounded)
}

/** `YYYY-MM-DD` 的判定（DateField 用它决定「这段输入能不能落盘」） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateInput(value: string): boolean {
  return DATE_RE.test(value)
}

/**
 * 日期一律 `YYYY-MM-DD` 呈现（§1.3）。
 *
 * 领域层的 `DateStr` 本就是 `YYYY-MM-DD`，这里原样返回；对带时间的 ISO 串只取日期段。
 * 非日期（空串 / undefined / 非法形状）返回 `null` —— 即 §3.3 的「算不出来」，
 * 由渲染层显示 `—`，而不是一个空白的日期框。
 *
 * 为什么需要它：原生 `<input type="date">` 的**显示格式由浏览器 locale 决定**
 * （zh-CN 下渲染成 `2026/09/14`），无法用 CSS 改写。因此右栏的日期输入改用文本框
 * 承载，展示值一律过这个函数 —— 规范说的「保留原生 YYYY/MM/DD 是缺陷」即指此。
 */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const head = value.slice(0, 10)
  return DATE_RE.test(head) ? head : null
}
