/**
 * lag 黄金矩阵（spec §3.1 的「文档规则推导矩阵」）
 *
 * 覆盖：4 依赖类型 × 3 lag 单位（workdays / elapsedDays / percent）× {正、零、负}，
 * 正推 + 逆推 = 36 + 36 组手算期望。每组期望都从 spec §1.1 的公式表 + 日历规则
 * **手工推导**，注释里给出「锚日 + 吸附步」。实测值由实现产出 —— 若不符，默认是
 * `constraints.ts` 的实现缺陷（不改期望值迁就实现）。
 *
 * 单位与公式（w = workdays/percent 折算后的工作日数，e = elapsed 的自然日数）：
 *   FS 正推 addWorkdays(A.finish, w+1)         | nextWorkday(addDays(A.finish, e))
 *   SS 正推 addWorkdays(A.start, w)            | snapToWorkday(addDays(A.start, e))
 *   FF 正推 taskStart(addWorkdays(A.finish, w))| taskStart(snapToWorkday(addDays(A.finish, e)))
 *   SF 正推 taskStart(addWorkdays(A.start, w)) | taskStart(snapToWorkday(addDays(A.start, e)))
 *   FS 逆推 addWorkdays(B.start, -(w+1))       | snapToWorkdayOrPrevious(addDays(B.start, -e-1))
 *   SS 逆推 taskFinish(addWorkdays(B.start, -w)) | taskFinish(snapToWorkdayOrPrevious(addDays(B.start, -e)))
 *   FF 逆推 addWorkdays(B.finish, -w)          | snapToWorkdayOrPrevious(addDays(B.finish, -e))
 *   SF 逆推 taskFinish(addWorkdays(B.finish, -w)) | taskFinish(snapToWorkdayOrPrevious(addDays(B.finish, -e)))
 *
 * 原语语义（src/domain/calendar/workdays.ts）：nextWorkday 严格取「之后」；snapToWorkday
 * 取「当日或之后」；snapToWorkdayOrPrevious 取「当日或之前」；addWorkdays 起点先向前
 * 吸附再计数（n=0 时返回吸附后的起点）；taskFinish(start, d) = d<=0 ? 吸附(start) : addWorkdays(start, d-1)；
 * taskStart(finish, d) = d<=0 ? 吸附(finish) : addWorkdays(finish, -(d-1))。
 *
 * 默认日历周一至周五（createCalendar），锚定 2026-03 上旬：
 *   03-02 一、03-04 三、03-05 四、03-06 五、03-09 一、03-10 二。
 */
import { describe, it, expect } from 'vitest'
import { createCalendar, createDependency, createTask } from '../model/factories'
import type { Calendar, Dependency, DependencyType, Lag, Task } from '../model/types'
import { asLag, backwardBound, effectiveLagWorkdays, forwardBound } from './constraints'
import { runCpm } from './cpm'

const cal = createCalendar()

const wd = (days: number): Lag => ({ kind: 'workdays', days })
const ed = (days: number): Lag => ({ kind: 'elapsedDays', days })
const pct = (value: number): Lag => ({ kind: 'percent', value })

function dep(type: DependencyType, lag: Lag): Dependency {
  return { id: 'd', fromTaskId: 'A', toTaskId: 'B', type, lag }
}

/** 正推锚：A 03-02(一)..03-04(三)，B 工期 2，A 工期 3（percent 折算用） */
interface FwdOver {
  fromStart?: string
  fromFinish?: string
  toDuration?: number
  fromDuration?: number
  cal?: Calendar
}
function fwd(type: DependencyType, lag: Lag, over: FwdOver = {}): string {
  return forwardBound({
    dep: dep(type, lag),
    fromStart: over.fromStart ?? '2026-03-02',
    fromFinish: over.fromFinish ?? '2026-03-04',
    toDuration: over.toDuration ?? 2,
    fromDuration: over.fromDuration ?? 3,
    cal: over.cal ?? cal,
  })
}

/** 逆推锚：B 03-05(四) 起 / 03-06(五) 止，A 工期 3（SS/SF 反推 A.finish 用） */
interface BwdOver {
  toStart?: string
  toFinish?: string
  fromDuration?: number
  cal?: Calendar
}
function bwd(type: DependencyType, lag: Lag, over: BwdOver = {}): string {
  return backwardBound({
    dep: dep(type, lag),
    toStart: over.toStart ?? '2026-03-05',
    toFinish: over.toFinish ?? '2026-03-06',
    fromDuration: over.fromDuration ?? 3,
    cal: over.cal ?? cal,
  })
}

// ═════════════════════════════════════════════════════════════════════
// 正推：4 类型 × 3 单位 × {正、零、负}
// ═════════════════════════════════════════════════════════════════════
describe('forwardBound — lag 黄金矩阵', () => {
  describe('FS', () => {
    it('workdays +2 / 0 / −2', () => {
      // +2: A.finish 03-04 + (2+1)=3 工作日 → 03-05(1) 03-06(2) 03-09(3) = 03-09
      expect(fwd('FS', wd(2))).toBe('2026-03-09')
      // 0: A.finish + 1 工作日 = 03-05
      expect(fwd('FS', wd(0))).toBe('2026-03-05')
      // −2: A.finish + (−2+1)=−1 工作日 → 03-04 的前一个工作日 = 03-03
      expect(fwd('FS', wd(-2))).toBe('2026-03-03')
    })

    it('elapsedDays +2 / 0 / −2', () => {
      // +2: addDays(03-04, 2) = 03-06(五) → nextWorkday = 03-09(一)
      expect(fwd('FS', ed(2))).toBe('2026-03-09')
      // 0: addDays(03-04, 0) = 03-04 → nextWorkday = 03-05（瞬时语义：不得同日相接）
      expect(fwd('FS', ed(0))).toBe('2026-03-05')
      // −2: addDays(03-04, −2) = 03-02(一) → nextWorkday = 03-03
      expect(fwd('FS', ed(-2))).toBe('2026-03-03')
    })

    it('percent +50 / 0 / −50（A 工期 3）', () => {
      // +50: w=ceil(1.5)=2 → w+1=3 工作日 → 03-09（同 workdays +2）
      expect(fwd('FS', pct(50))).toBe('2026-03-09')
      // 0: w=ceil(0)=0 → w+1=1 → 03-05
      expect(fwd('FS', pct(0))).toBe('2026-03-05')
      // −50: w=ceil(−1.5)=−1 → w+1=0 → addWorkdays(03-04, 0) = 03-04
      expect(fwd('FS', pct(-50))).toBe('2026-03-04')
    })
  })

  describe('SS', () => {
    it('workdays +2 / 0 / −2', () => {
      // +2: A.start 03-02 + 2 工作日 → 03-03(1) 03-04(2) = 03-04
      expect(fwd('SS', wd(2))).toBe('2026-03-04')
      // 0: addWorkdays(03-02, 0) = 03-02
      expect(fwd('SS', wd(0))).toBe('2026-03-02')
      // −2: 03-02 → 02-27(五)(1) → 02-26(四)(2)，跨周末
      expect(fwd('SS', wd(-2))).toBe('2026-02-26')
    })

    it('elapsedDays +2 / 0 / −2', () => {
      // +2: addDays(03-02, 2) = 03-04(三) 工作日 → 03-04
      expect(fwd('SS', ed(2))).toBe('2026-03-04')
      // 0: 03-02 工作日 → 03-02
      expect(fwd('SS', ed(0))).toBe('2026-03-02')
      // −2: addDays(03-02, −2) = 02-28(六) → snapToWorkday 向后吸附 = 03-02(一)
      expect(fwd('SS', ed(-2))).toBe('2026-03-02')
    })

    it('percent +50 / 0 / −50（A 工期 3）', () => {
      // +50: w=2 → 03-04
      expect(fwd('SS', pct(50))).toBe('2026-03-04')
      // 0: w=0 → 03-02
      expect(fwd('SS', pct(0))).toBe('2026-03-02')
      // −50: w=−1 → addWorkdays(03-02, −1) = 02-27(五)
      expect(fwd('SS', pct(-50))).toBe('2026-02-27')
    })
  })

  describe('FF', () => {
    it('workdays +2 / 0 / −2', () => {
      // +2: finishBound = addWorkdays(03-04, 2) = 03-06 → taskStart(03-06, 工期2) = addWorkdays(03-06, −1) = 03-05
      expect(fwd('FF', wd(2))).toBe('2026-03-05')
      // 0: finishBound = 03-04 → taskStart(03-04, 2) = 03-03
      expect(fwd('FF', wd(0))).toBe('2026-03-03')
      // −2: finishBound = addWorkdays(03-04, −2) = 03-02 → taskStart(03-02, 2) = 02-27
      expect(fwd('FF', wd(-2))).toBe('2026-02-27')
    })

    it('elapsedDays +2 / 0 / −2', () => {
      // +2: finishBound = snapToWorkday(addDays(03-04, 2)=03-06) = 03-06 → taskStart = 03-05
      expect(fwd('FF', ed(2))).toBe('2026-03-05')
      // 0: finishBound = 03-04 → taskStart(03-04, 2) = 03-03（B 与 A 同日结束 03-04）
      expect(fwd('FF', ed(0))).toBe('2026-03-03')
      // −2: finishBound = snapToWorkday(addDays(03-04, −2)=03-02) = 03-02 → taskStart = 02-27
      expect(fwd('FF', ed(-2))).toBe('2026-02-27')
    })

    it('percent +50 / 0 / −50（A 工期 3）', () => {
      // +50: w=2 → finishBound 03-06 → taskStart = 03-05
      expect(fwd('FF', pct(50))).toBe('2026-03-05')
      // 0: w=0 → finishBound 03-04 → taskStart = 03-03
      expect(fwd('FF', pct(0))).toBe('2026-03-03')
      // −50: w=−1 → finishBound addWorkdays(03-04, −1)=03-03 → taskStart(03-03, 2)=03-02
      expect(fwd('FF', pct(-50))).toBe('2026-03-02')
    })
  })

  describe('SF', () => {
    it('workdays +2 / 0 / −2', () => {
      // +2: finishBound = addWorkdays(03-02, 2) = 03-04 → taskStart(03-04, 2) = 03-03
      expect(fwd('SF', wd(2))).toBe('2026-03-03')
      // 0: finishBound = 03-02 → taskStart(03-02, 2) = 02-27
      expect(fwd('SF', wd(0))).toBe('2026-02-27')
      // −2: finishBound = addWorkdays(03-02, −2) = 02-26 → taskStart(02-26, 2) = 02-25(三)
      expect(fwd('SF', wd(-2))).toBe('2026-02-25')
    })

    it('elapsedDays +2 / 0 / −2', () => {
      // +2: finishBound = snapToWorkday(addDays(03-02, 2)=03-04) = 03-04 → taskStart = 03-03
      expect(fwd('SF', ed(2))).toBe('2026-03-03')
      // 0: finishBound = 03-02 → taskStart = 02-27
      expect(fwd('SF', ed(0))).toBe('2026-02-27')
      // −2: addDays(03-02, −2)=02-28(六) → snapToWorkday 向后 = 03-02(一) → taskStart(03-02, 2) = 02-27
      expect(fwd('SF', ed(-2))).toBe('2026-02-27')
    })

    it('percent +50 / 0 / −50（A 工期 3）', () => {
      // +50: w=2 → finishBound 03-04 → taskStart = 03-03
      expect(fwd('SF', pct(50))).toBe('2026-03-03')
      // 0: w=0 → finishBound 03-02 → taskStart = 02-27
      expect(fwd('SF', pct(0))).toBe('2026-02-27')
      // −50: w=−1 → finishBound addWorkdays(03-02, −1)=02-27 → taskStart(02-27, 2)=02-26
      expect(fwd('SF', pct(-50))).toBe('2026-02-26')
    })
  })
})

// ═════════════════════════════════════════════════════════════════════
// 逆推：4 类型 × 3 单位 × {正、零、负}
// ═════════════════════════════════════════════════════════════════════
describe('backwardBound — lag 黄金矩阵', () => {
  describe('FS', () => {
    it('workdays +2 / 0 / −2', () => {
      // +2: B.start 03-05 − (2+1)=3 工作日 → 03-04(1) 03-03(2) 03-02(3) = 03-02
      expect(bwd('FS', wd(2))).toBe('2026-03-02')
      // 0: 03-05 − 1 = 03-04
      expect(bwd('FS', wd(0))).toBe('2026-03-04')
      // −2: 03-05 − (−2+1) = +1 工作日 → 03-06
      expect(bwd('FS', wd(-2))).toBe('2026-03-06')
    })

    it('elapsedDays +2 / 0 / −2', () => {
      // +2: addDays(03-05, −2−1=−3) = 03-02 → snapToWorkdayOrPrevious = 03-02
      expect(bwd('FS', ed(2))).toBe('2026-03-02')
      // 0: addDays(03-05, −0−1=−1) = 03-04 → 03-04（不得同日：A 须早于 B 一天）
      expect(bwd('FS', ed(0))).toBe('2026-03-04')
      // −2: −e−1 = 2−1 = +1 → addDays(03-05, 1) = 03-06 → 03-06
      expect(bwd('FS', ed(-2))).toBe('2026-03-06')
    })

    it('percent +50 / 0 / −50（A 工期 3）', () => {
      // +50: w=2 → 03-05 − 3 = 03-02
      expect(bwd('FS', pct(50))).toBe('2026-03-02')
      // 0: w=0 → 03-05 − 1 = 03-04
      expect(bwd('FS', pct(0))).toBe('2026-03-04')
      // −50: w=−1 → 03-05 − 0 = addWorkdays(03-05, 0) = 03-05
      expect(bwd('FS', pct(-50))).toBe('2026-03-05')
    })
  })

  describe('SS', () => {
    it('workdays +2 / 0 / −2（A 工期 3）', () => {
      // +2: A.start = addWorkdays(03-05, −2) = 03-03 → A.finish = taskFinish(03-03, 3) = 03-05
      expect(bwd('SS', wd(2))).toBe('2026-03-05')
      // 0: A.start = 03-05 → taskFinish(03-05, 3) = addWorkdays(03-05, 2) = 03-09（跨周末）
      expect(bwd('SS', wd(0))).toBe('2026-03-09')
      // −2: A.start = addWorkdays(03-05, 2) = 03-09 → taskFinish(03-09, 3) = 03-11
      expect(bwd('SS', wd(-2))).toBe('2026-03-11')
    })

    it('elapsedDays +2 / 0 / −2（A 工期 3）', () => {
      // +2: A.start = snapOrPrev(addDays(03-05, −2)=03-03) = 03-03 → taskFinish(03-03, 3) = 03-05
      expect(bwd('SS', ed(2))).toBe('2026-03-05')
      // 0: A.start = snapOrPrev(03-05) = 03-05 → taskFinish(03-05, 3) = 03-09
      expect(bwd('SS', ed(0))).toBe('2026-03-09')
      // −2: addDays(03-05, 2) = 03-07(六) → snapOrPrev 向前 = 03-06(五)
      //     → taskFinish(03-06, 3) = addWorkdays(03-06, 2) = 03-10
      //     （注意：这里是 addDays 自然日 ≠ workdays 的 addWorkdays 03-09）
      expect(bwd('SS', ed(-2))).toBe('2026-03-10')
    })

    it('percent +50 / 0 / −50（A 工期 3）', () => {
      // +50: w=2 → A.start 03-03 → A.finish 03-05
      expect(bwd('SS', pct(50))).toBe('2026-03-05')
      // 0: w=0 → A.start 03-05 → A.finish 03-09
      expect(bwd('SS', pct(0))).toBe('2026-03-09')
      // −50: w=−1 → A.start addWorkdays(03-05, 1)=03-06 → taskFinish(03-06, 3)=03-10
      expect(bwd('SS', pct(-50))).toBe('2026-03-10')
    })
  })

  describe('FF', () => {
    it('workdays +2 / 0 / −2', () => {
      // +2: B.finish 03-06 − 2 工作日 → 03-05(1) 03-04(2) = 03-04
      expect(bwd('FF', wd(2))).toBe('2026-03-04')
      // 0: addWorkdays(03-06, −0) = 03-06（−0 工作日即当日，不移动）
      expect(bwd('FF', wd(0))).toBe('2026-03-06')
      // −2: 03-06 + 2 工作日 → 03-09(1) 03-10(2) = 03-10
      expect(bwd('FF', wd(-2))).toBe('2026-03-10')
    })

    it('elapsedDays +2 / 0 / −2', () => {
      // +2: addDays(03-06, −2)=03-04 → snapOrPrev = 03-04
      expect(bwd('FF', ed(2))).toBe('2026-03-04')
      // 0: snapToWorkdayOrPrevious(addDays(03-06, −0)=03-06) = 03-06（当日为工作日）
      expect(bwd('FF', ed(0))).toBe('2026-03-06')
      // −2: addDays(03-06, 2)=03-08(日) → snapOrPrev 向前吸附 = 03-06(五)，跨周末
      expect(bwd('FF', ed(-2))).toBe('2026-03-06')
    })

    it('percent +50 / 0 / −50（A 工期 3）', () => {
      // +50: w=2 → 03-06 − 2 = 03-04
      expect(bwd('FF', pct(50))).toBe('2026-03-04')
      // 0: w=ceil(0×3/100)=0 → addWorkdays(03-06, −0) = 03-06（0 工作日即当日）
      expect(bwd('FF', pct(0))).toBe('2026-03-06')
      // −50: w=−1 → 03-06 + 1 工作日 = 03-09
      expect(bwd('FF', pct(-50))).toBe('2026-03-09')
    })
  })

  describe('SF', () => {
    it('workdays +2 / 0 / −2（A 工期 3）', () => {
      // +2: A.start = addWorkdays(03-06, −2) = 03-04 → A.finish = taskFinish(03-04, 3) = 03-06
      expect(bwd('SF', wd(2))).toBe('2026-03-06')
      // 0: A.start = 03-06 → taskFinish(03-06, 3) = addWorkdays(03-06, 2) = 03-10
      expect(bwd('SF', wd(0))).toBe('2026-03-10')
      // −2: A.start = addWorkdays(03-06, 2) = 03-10 → taskFinish(03-10, 3) = 03-12
      expect(bwd('SF', wd(-2))).toBe('2026-03-12')
    })

    it('elapsedDays +2 / 0 / −2（A 工期 3）', () => {
      // +2: A.start = snapOrPrev(addDays(03-06, −2)=03-04) = 03-04 → taskFinish(03-04, 3) = 03-06
      expect(bwd('SF', ed(2))).toBe('2026-03-06')
      // 0: A.start = snapOrPrev(03-06) = 03-06 → taskFinish(03-06, 3) = 03-10
      expect(bwd('SF', ed(0))).toBe('2026-03-10')
      // −2: addDays(03-06, 2)=03-08(日) → snapOrPrev = 03-06(五) → taskFinish(03-06, 3) = 03-10
      expect(bwd('SF', ed(-2))).toBe('2026-03-10')
    })

    it('percent +50 / 0 / −50（A 工期 3）', () => {
      // +50: w=2 → A.start 03-04 → A.finish 03-06
      expect(bwd('SF', pct(50))).toBe('2026-03-06')
      // 0: w=0 → A.start 03-06 → A.finish 03-10
      expect(bwd('SF', pct(0))).toBe('2026-03-10')
      // −50: w=−1 → A.start addWorkdays(03-06, 1)=03-09 → taskFinish(03-09, 3)=03-11
      expect(bwd('SF', pct(-50))).toBe('2026-03-11')
    })
  })
})

// ═════════════════════════════════════════════════════════════════════
// 边界：跨周末（周五锚）
// ═════════════════════════════════════════════════════════════════════
describe('lag 矩阵 — 边界：跨周末（周五锚）', () => {
  it('FS 工作日的正推：周五完成 → 次工作日周一', () => {
    // A.finish 03-06(五) + 1 工作日：03-07 六、03-08 日 跳过 → 03-09(一)
    expect(fwd('FS', wd(0), { fromFinish: '2026-03-06' })).toBe('2026-03-09')
  })

  it('FS 工作日的逆推：周一开始 → 上界回到周五', () => {
    // B.start 03-09(一) − 1 工作日：03-08 日、03-07 六 跳过 → 03-06(五)
    expect(bwd('FS', wd(0), { toStart: '2026-03-09' })).toBe('2026-03-06')
  })

  it('FS 自然日的正推：周四完成 + 2 自然日 = 周六 → 次工作日周一', () => {
    // addDays(03-05, 2) = 03-07(六) → nextWorkday = 03-09(一)
    expect(fwd('FS', ed(2), { fromFinish: '2026-03-05' })).toBe('2026-03-09')
  })
})

// ═════════════════════════════════════════════════════════════════════
// 边界：跨节假日例外（2026-03-10 周二设为 holiday）
// ═════════════════════════════════════════════════════════════════════
describe('lag 矩阵 — 边界：跨节假日例外（2026-03-10）', () => {
  const holed: Calendar = createCalendar()
  holed.exceptions['2026-03-10'] = { kind: 'holiday' } // 周二非工作日

  it('FS 自然日 + 0：03-09 完成 → 跳过 03-10 假日 → 03-11', () => {
    // nextWorkday(03-09)：03-10 是假日 → 03-11(三)
    expect(fwd('FS', ed(0), { fromFinish: '2026-03-09', cal: holed })).toBe('2026-03-11')
  })

  it('FS 工作日 + 1：03-06 完成 → 计数跳过 03-10', () => {
    // addWorkdays(03-06, 2)：03-09(1)、03-10 假日跳过、03-11(2) = 03-11
    expect(fwd('FS', wd(1), { fromFinish: '2026-03-06', cal: holed })).toBe('2026-03-11')
  })

  it('FS 工作日的逆推：03-11 开始 → 回退跳过 03-10', () => {
    // addWorkdays(03-11, −1)：03-10 假日跳过 → 03-09(一)
    expect(bwd('FS', wd(0), { toStart: '2026-03-11', cal: holed })).toBe('2026-03-09')
  })

  it('FF 自然日的逆推：完成日恰落假日 → 向前吸附到 03-09', () => {
    // snapToWorkdayOrPrevious(addDays(03-10, 0)=03-10)：假日 → 向前 = 03-09(一)
    expect(bwd('FF', ed(0), { toFinish: '2026-03-10', cal: holed })).toBe('2026-03-09')
  })

  it('SS 自然日的正推：起点恰落假日 → 向后吸附到 03-11', () => {
    // snapToWorkday(addDays(03-10, 0)=03-10)：假日 → 向后 = 03-11(三)
    expect(fwd('SS', ed(0), { fromStart: '2026-03-10', cal: holed })).toBe('2026-03-11')
  })
})

// ═════════════════════════════════════════════════════════════════════
// 边界：percent 取整（±2.5）与前置工期 0
// ═════════════════════════════════════════════════════════════════════
describe('lag 矩阵 — 边界：percent 取整与工期 0', () => {
  it('effectiveLagWorkdays：±2.5 两个方向都取 ceil（宁晚勿早）', () => {
    // fromDuration 5、+50% → ceil(2.5)=3；−50% → ceil(−2.5)=−2
    expect(effectiveLagWorkdays(pct(50), 5)).toBe(3)
    expect(effectiveLagWorkdays(pct(-50), 5)).toBe(-2)
  })

  it('正推 FS：+2.5 → 3 工作日；−2.5 → −2 工作日（A 工期 5）', () => {
    // A.finish 03-04 + (3+1)=4 工作日 → 03-05 03-06 03-09 03-10 = 03-10
    expect(fwd('FS', pct(50), { fromDuration: 5 })).toBe('2026-03-10')
    // A.finish 03-04 + (−2+1)=−1 工作日 = 03-03
    expect(fwd('FS', pct(-50), { fromDuration: 5 })).toBe('2026-03-03')
  })

  it('前置工期 0（里程碑）：percent 折算为 0，正推 = 纯 FS 偏移', () => {
    // w = ceil(50×0/100) = 0 → addWorkdays(03-04, 1) = 03-05
    expect(fwd('FS', pct(50), { fromDuration: 0 })).toBe('2026-03-05')
    expect(effectiveLagWorkdays(pct(50), 0)).toBe(0)
  })

  it('前置工期 0：逆推 FS 同样按 w=0 计算', () => {
    // w = 0 → addWorkdays(03-05, −1) = 03-04
    expect(bwd('FS', pct(50), { fromDuration: 0 })).toBe('2026-03-04')
  })

  it('asLag：裸数字归一为 workdays（旧存档兼容）', () => {
    expect(asLag(2)).toEqual(wd(2))
    expect(asLag(pct(50))).toEqual(pct(50))
  })
})

// ═════════════════════════════════════════════════════════════════════
// 边界：elapsedDays 的瞬时语义
// ═════════════════════════════════════════════════════════════════════
describe('lag 矩阵 — 边界：elapsedDays 瞬时语义', () => {
  it('FS + 0 自然日：后继不得与前置同日开工（nextWorkday）', () => {
    // A.finish 03-04 → nextWorkday = 03-05，而非同日 03-04（结束日 18:00 瞬时）
    expect(fwd('FS', ed(0), { fromFinish: '2026-03-04' })).toBe('2026-03-05')
    expect(fwd('FS', ed(0), { fromFinish: '2026-03-04' })).not.toBe('2026-03-04')
  })

  it('FF + 0 自然日：允许同日结束（单日任务完工日 = A 完工日）', () => {
    // finishBound = snapToWorkday(03-04) = 03-04；taskStart(03-04, 工期1) = 03-04
    // → B 单日 03-04 完工，与 A.finish 同日（「不得重叠，除瞬时相接」）
    expect(fwd('FF', ed(0), { fromFinish: '2026-03-04', toDuration: 1 })).toBe('2026-03-04')
  })

  it('逆推 FS + 0 自然日：A 须早于 B 开始一天（不得同日）', () => {
    // snapOrPrev(addDays(03-04, −1)=03-03) = 03-03
    expect(bwd('FS', ed(0), { toStart: '2026-03-04' })).toBe('2026-03-03')
  })
})

// ═════════════════════════════════════════════════════════════════════
// 边界：负 elapsed 跨周
// ═════════════════════════════════════════════════════════════════════
describe('lag 矩阵 — 边界：负 elapsed 跨周', () => {
  it('SS 正推 −2：落周六 → snapToWorkday 向后吸附回周一', () => {
    // addDays(03-02, −2) = 02-28(六) → 向后吸附 = 03-02(一)
    expect(fwd('SS', ed(-2), { fromStart: '2026-03-02' })).toBe('2026-03-02')
  })

  it('FS 正推 −1：落周日 → nextWorkday 回到周一', () => {
    // addDays(03-09, −1) = 03-08(日) → nextWorkday = 03-09(一)
    expect(fwd('FS', ed(-1), { fromFinish: '2026-03-09' })).toBe('2026-03-09')
  })

  it('FF 逆推 −2：落周日 → snapToWorkdayOrPrevious 回到周五', () => {
    // addDays(03-06, 2) = 03-08(日) → 向前吸附 = 03-06(五)
    expect(bwd('FF', ed(-2), { toFinish: '2026-03-06' })).toBe('2026-03-06')
  })
})

// ═════════════════════════════════════════════════════════════════════
// freeSlack 在 lag ≠ 0 的整链上（经 runCpm，带 lag 的边一推松弛为 0）
// ═════════════════════════════════════════════════════════════════════
describe('lag 矩阵 — freeSlack 在 lag ≠ 0 的整链上（runCpm）', () => {
  const mk = (name: string, duration: number): Task => ({
    ...createTask({ name, duration }),
    id: name,
  })
  const solve = (tasks: Task[], deps: Dependency[]) =>
    runCpm({
      tasks,
      dependencies: deps,
      calendar: cal,
      direction: 'forward',
      projectStart: '2026-03-02',
    })

  it('FS 工作日 lag=2：一推就动后继 → A 的自由宽延为 0（判别性）', () => {
    // A(2d) 03-02..03-03；B 经 FS lag 2：forwardBound = addWorkdays(03-03, 3) = 03-06。
    // A.freeSlack = workdaysBetween(forwardBound 03-06, B.earlyStart 03-06) = 0。
    // 判别性：旧式 workdaysBetween(A.finish 03-03, B.start 03-06) − 1 = 3 − 1 = 2 ≠ 0 ——
    // 带 lag 的边若按「完成日间距减一」会高估松弛；forwardBound 口径才是 0。
    const r = solve([mk('A', 2), mk('B', 1)], [createDependency('A', 'B', 'FS', wd(2))])
    expect(r.B.earlyStart).toBe('2026-03-06')
    expect(r.A.freeSlack).toBe(0)
    // B 是终端任务（无出边）：cpm.ts 直接把 freeSlack 回退成 totalSlack。
    // 这条只 pin 终端回退行为，**不检验**边公式 —— 边公式的判别性在上一行的 A.freeSlack。
    expect(r.B.freeSlack).toBe(r.B.totalSlack)
  })

  it('SS 工作日 lag=1：后继起点由该边决定 → A 的自由宽延为 0', () => {
    // A(3d) 03-02..03-04；B 经 SS lag 1：forwardBound = addWorkdays(A.start 03-02, 1) = 03-03
    // → B.earlyStart 03-03（B 2d → 03-03..03-04）。A.freeSlack = workdaysBetween(03-03, 03-03) = 0。
    const r = solve([mk('A', 3), mk('B', 2)], [createDependency('A', 'B', 'SS', wd(1))])
    expect(r.B.earlyStart).toBe('2026-03-03')
    expect(r.A.freeSlack).toBe(0)
    // B 是终端任务（无出边）：freeSlack = totalSlack = 0。同样只 pin 终端回退，
    // 不检验边公式 —— 判别性在上一行的 A.freeSlack。
    expect(r.B.freeSlack).toBe(0)
  })

  it('FF 百分比 lag=50%：折算后的边决定后继终点 → A 的自由宽延为 0', () => {
    // A(4d) 03-02..03-05；percent 50 折算 ceil(50×4/100)=2 工作日。
    // forwardBound = taskStart(addWorkdays(03-05, 2), B 工期 2) = taskStart(03-09, 2) = 03-06
    // → B.earlyStart 03-06，B 2d → 03-06..03-09。A.freeSlack = workdaysBetween(03-06, 03-06) = 0。
    const r = solve([mk('A', 4), mk('B', 2)], [createDependency('A', 'B', 'FF', pct(50))])
    expect(r.B.earlyStart).toBe('2026-03-06')
    expect(r.B.earlyFinish).toBe('2026-03-09')
    expect(r.A.freeSlack).toBe(0)
  })
})
