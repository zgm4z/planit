import type { Calendar, DateStr, Dependency } from '../model/types'
import { addWorkdays, taskFinish, taskStart } from '../calendar/workdays'

export interface ForwardInput {
  dep: Dependency
  fromStart: DateStr
  fromFinish: DateStr
  /** 后续任务的工期，FF/SF 换算开始日期时需要 */
  toDuration: number
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

/**
 * 正推：该依赖对「后续任务最早开始日期」的下界。
 * 返回的日期一定落在工作日上。
 */
export function forwardBound(input: ForwardInput): DateStr {
  const { dep, fromStart, fromFinish, toDuration, cal } = input

  switch (dep.type) {
    case 'FS':
      // A.finish + lag < B.start，即 B 在 A 完成后的第 (lag + 1) 个工作日开工
      return addWorkdays(fromFinish, dep.lag + 1, cal)

    case 'SS':
      return addWorkdays(fromStart, dep.lag, cal)

    case 'FF': {
      // B.finish >= A.finish + lag → 再由 finish 反推 B.start
      const finishBound = addWorkdays(fromFinish, dep.lag, cal)
      return taskStart(finishBound, toDuration, cal)
    }

    case 'SF': {
      const finishBound = addWorkdays(fromStart, dep.lag, cal)
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

  switch (dep.type) {
    case 'FS':
      // A.finish <= B.start - (lag + 1)
      return addWorkdays(toStart, -(dep.lag + 1), cal)

    case 'SS': {
      // A.start <= B.start - lag → 再由 A.start 推 A.finish
      const startBound = addWorkdays(toStart, -dep.lag, cal)
      return taskFinish(startBound, fromDuration, cal)
    }

    case 'FF':
      // A.finish <= B.finish - lag
      return addWorkdays(toFinish, -dep.lag, cal)

    case 'SF': {
      // A.start <= B.finish - lag
      const startBound = addWorkdays(toFinish, -dep.lag, cal)
      return taskFinish(startBound, fromDuration, cal)
    }
  }
}
