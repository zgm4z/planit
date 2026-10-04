import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createCalendar, createTask } from '../../domain/model/factories'
import type { ComputedSchedule, Task } from '../../domain/model/types'
import { TaskBar } from './TaskBar'
import { createScale } from './timeline'
import styles from '../styles/GanttPane.module.scss'
import i18n from '../../i18n'

function schedule(start: string, finish: string): ComputedSchedule {
  return {
    earlyStart: start,
    earlyFinish: finish,
    lateStart: start,
    lateFinish: finish,
    scheduledStart: start,
    scheduledFinish: finish,
    totalSlack: 0,
    freeSlack: 0,
    isCritical: false,
  }
}

function renderBar(task: Task, props: Partial<React.ComponentProps<typeof TaskBar>> = {}) {
  return render(
    <TaskBar
      task={task}
      schedule={schedule('2026-03-02', '2026-03-03')}
      scale={createScale('2026-03-02', 24)}
      calendar={createCalendar()}
      hasConflict={false}
      {...props}
    />,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
})

describe('TaskBar 条内资源名', () => {
  it('无 resourceNames（或空数组）时不渲染 .barLabel，title 也不加名字行', () => {
    const task = createTask({ name: 'T1' })
    renderBar(task)
    expect(screen.queryByTestId(`task-bar-label-${task.id}`)).not.toBeInTheDocument()
    expect(screen.getByTestId(`task-bar-${task.id}`).getAttribute('title')).not.toContain('已分配')
  })

  it('有名字时药丸文本 = 资源名按 gantt.resourceSeparator 连接（zh 用顿号）', () => {
    const task = createTask({ name: 'T1' })
    renderBar(task, { resourceNames: ['张三', '李四'] })
    expect(screen.getByTestId(`task-bar-label-${task.id}`)).toHaveTextContent('张三、李四')
  })

  it('空数组视同无分配 —— 不渲染药丸', () => {
    const task = createTask({ name: 'T1' })
    renderBar(task, { resourceNames: [] })
    expect(screen.queryByTestId(`task-bar-label-${task.id}`)).not.toBeInTheDocument()
  })

  it('.bar 的 title 追加「已分配：…」行，保留原有起止行', () => {
    const task = createTask({ name: 'T1' })
    renderBar(task, { resourceNames: ['张三', '李四'] })
    const title = screen.getByTestId(`task-bar-${task.id}`).getAttribute('title') ?? ''
    expect(title).toContain('已分配：张三、李四')
    expect(title).toContain('2026-03-02 → 2026-03-03')
  })

  it('manual 条的药丸带 .barLabelManual（让开左侧锁）', () => {
    const task = createTask({ name: 'T1' })
    task.scheduling = { mode: 'manual', start: '2026-03-02', finish: '2026-03-03' }
    renderBar(task, { resourceNames: ['张三'] })
    expect(screen.getByTestId(`task-bar-label-${task.id}`).className).toContain(
      styles.barLabelManual,
    )
  })

  it('里程碑不渲染任何文字子节点，但 title 含名单', () => {
    const milestone = createTask({ name: 'M', kind: 'milestone' })
    renderBar(milestone, { resourceNames: ['张三', '李四'] })
    const el = screen.getByTestId(`task-milestone-${milestone.id}`)
    expect(el).toBeEmptyDOMElement()
    expect(el.getAttribute('title')).toContain('已分配：张三、李四')
  })
})
