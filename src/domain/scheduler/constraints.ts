import type { Calendar, DateStr, Dependency, Lag } from '../model/types'
import { addDays, addWorkdays, nextWorkday, snapToWorkday, snapToWorkdayOrPrevious, taskFinish, taskStart } from '../calendar/workdays'

export interface ForwardInput {
  dep: Dependency
  fromStart: DateStr
  fromFinish: DateStr
  /** 后续任务的工期，FF/SF 换算开始日期时需要 */
  toDuration: number
  /** 前置任务的工期，percent 折算 lag 时需要 */
  fromDuration: number
  cal: Calendar
}

export interface BackwardInput {
  dep: Dependency
  toStart: DateStr
  toFinish: DateStr
  /** 前置任务的工期，SS/SF 换算结束日期时需要 */
  fromDuration: number
  cal: Calendar
}

/** 裸数字兼容：旧存档 / 旧调用点传入的 number 视为 workdays */
export function asLag(lag: Lag | number): Lag {
  if (typeof lag === 'number') return { kind: 'workdays', days: lag }
  return lag
}

/**
 * 把 lag 换算成「工作日」标量。
 * - workdays：原样返回 days
 * - percent：按前置工期折算后向上取整（宁晚勿早）
 * - elapsedDays：没有标量形式，返回 NaN 供断言防御 ——
 *   调用方必须走 forwardBound/backwardBound 的 elapsed 分支
 */
export function effectiveLagWorkdays(lag: Lag, fromDuration: number): number {
  const normalized = asLag(lag)
  switch (normalized.kind) {
    case 'workdays':
      return normalized.days
    case 'percent':
      return Math.ceil((normalized.value * fromDuration) / 100)
    case 'elapsedDays':
      return Number.NaN
  }
}

/**
 * 正推：该依赖对「后续任务最早开始日期」的下界。
 * 返回的日期一定落在工作日上。
 */
export function forwardBound(input: ForwardInput): DateStr {
  const { dep, fromStart, fromFinish, toDuration, fromDuration, cal } = input
  const lag = asLag(dep.lag)
  const w = effectiveLagWorkdays(lag, fromDuration)
  const e = lag.kind === 'elapsedDays' ? lag.days : Number.NaN

  switch (dep.type) {
    case 'FS':
      // A.finish + lag < B.start，即 B 在 A 完成后的第 (lag + 1) 个工作日开工
      return lag.kind === 'elapsedDays'
        ? nextWorkday(addDays(fromFinish, e), cal)
        : addWorkdays(fromFinish, w + 1, cal)

    case 'SS':
      return lag.kind === 'elapsedDays'
        ? snapToWorkday(addDays(fromStart, e), cal)
        : addWorkdays(fromStart, w, cal)

    case 'FF': {
      // B.finish >= A.finish + lag → 再由 finish 反推 B.start
      const finishBound =
        lag.kind === 'elapsedDays'
          ? snapToWorkday(addDays(fromFinish, e), cal)
          : addWorkdays(fromFinish, w, cal)
      return taskStart(finishBound, toDuration, cal)
    }

    case 'SF': {
      const finishBound =
        lag.kind === 'elapsedDays'
          ? snapToWorkday(addDays(fromStart, e), cal)
          : addWorkdays(fromStart, w, cal)
      return taskStart(finishBound, toDuration, cal)
    }
  }
}

/**
 * 逆推：该依赖对「前置任务最晚结束日期」的上界。
 * 返回的日期一定落在工作日上。
 */
export function backwardBound(input: BackwardInput): DateStr {
  const { dep, toStart, toFinish, fromDuration, cal } = input
  const lag = asLag(dep.lag)
  const w = effectiveLagWorkdays(lag, fromDuration)
  const e = lag.kind === 'elapsedDays' ? lag.days : Number.NaN

  switch (dep.type) {
    case 'FS':
      // A.finish <= B.start - (lag + 1)
      return lag.kind === 'elapsedDays'
        ? snapToWorkdayOrPrevious(addDays(toStart, -e - 1), cal)
        : addWorkdays(toStart, -(w + 1), cal)

    case 'SS': {
      // A.start <= B.start - lag → 再由 A.start 推 A.finish
      const startBound =
        lag.kind === 'elapsedDays'
          ? snapToWorkdayOrPrevious(addDays(toStart, -e), cal)
          : addWorkdays(toStart, -w, cal)
      return taskFinish(startBound, fromDuration, cal)
    }

    case 'FF':
      // A.finish <= B.finish - lag
      return lag.kind === 'elapsedDays'
        ? snapToWorkdayOrPrevious(addDays(toFinish, -e), cal)
        : addWorkdays(toFinish, -w, cal)

    case 'SF': {
      // A.start <= B.finish - lag
      const startBound =
        lag.kind === 'elapsedDays'
          ? snapToWorkdayOrPrevious(addDays(toFinish, -e), cal)
          : addWorkdays(toFinish, -w, cal)
      return taskFinish(startBound, fromDuration, cal)
    }
  }
}
