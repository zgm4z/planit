# 蒙特卡洛模拟功能设计文档

**日期**: 2026-10-05  
**状态**: 设计完成，待实施  
**作者**: Brainstorming Session

---

## 1. 概述

### 1.1 目标

为 Planit 项目管理工具新增**蒙特卡洛模拟**功能，通过概率建模量化项目工期的不确定性，帮助用户：

1. **获得项目完工日期的概率分布**（例如："有 80% 概率在 6 月 28 日前完工"）
2. **识别高风险任务**（哪些任务的不确定性对整体工期影响最大）

### 1.2 核心原理

- 用户为任务提供**三点估算**（乐观 / 最可能 / 悲观工期）
- 系统运行数千次模拟，每次从概率分布中采样任务工期
- 每次模拟调用完整的 `solve()` 函数（CPM + 约束，但跳过资源平衡）
- 汇总所有模拟的项目完工日期，生成概率分布图

### 1.3 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 输入方式 | 三点估算（O/M/P） | 项目管理标准，易于理解 |
| 触发方式 | 手动触发 | 用户可控，不影响日常编辑 |
| 模拟范围 | 所有叶子任务 | 全面评估风险 |
| 默认不确定性 | ±20% | 行业常见估算误差 |
| 迭代次数 | 可配置（500/1000/5000） | 平衡速度与精度 |
| 资源平衡 | 禁用 | 保持计算速度可控 |
| 数据存储 | 独立 SimulationConfig | 不污染核心任务模型 |
| 结果展示 | 独立 Simulation 视图 | 专注风险分析 |
| 架构 | 复用完整 solve() | 零代码复制，语义一致 |
| 性能 | 1000 次约 58 秒 | 可接受的 trade-off |

---

## 2. 数据模型

### 2.1 SimulationConfig（模拟配置）

存储在 Zustand store 中，与 `project` 平级：

```typescript
interface SimulationConfig {
  // 任务级不确定性（用户手动设置的三点估算）
  taskUncertainties: Record<TaskId, ThreePointEstimate>
  
  // 全局默认不确定性（未设置三点估算的任务）
  defaultUncertainty: {
    optimisticFactor: number   // 默认 0.8  (工期 × 0.8)
    pessimisticFactor: number  // 默认 1.2  (工期 × 1.2)
  }
  
  // 模拟参数
  iterations: 500 | 1000 | 5000  // 快速 / 标准 / 精确
}

interface ThreePointEstimate {
  optimistic: number    // 乐观工期（工作日）
  mostLikely: number    // 最可能工期（= 任务的 duration）
  pessimistic: number   // 悲观工期（工作日）
}
```

### 2.2 SimulationResult（模拟结果）

```typescript
interface SimulationResult {
  // 基础信息
  timestamp: string          // 运行时间（ISO 格式）
  iterations: number         // 实际迭代次数
  projectId: string
  
  // 项目完工日期分布
  finishDateDistribution: {
    dates: DateStr[]         // 所有采样的完工日期（排序后）
    
    histogram: {             // 直方图数据（用于绘图）
      bins: Array<{
        start: DateStr
        end: DateStr
        count: number        // 落在该区间的样本数
      }>
    }
    
    percentiles: {           // 关键百分位
      p10: DateStr           // 10% 分位
      p50: DateStr           // 中位数（最重要）
      p80: DateStr           // 80% 置信度
      p90: DateStr           // 90% 置信度
      p95: DateStr           // 95% 置信度
    }
    
    mean: DateStr            // 期望值（算术平均）
    mode: DateStr            // 众数（最频繁出现的日期）
  }
  
  // 元数据
  duration: number           // 模拟总耗时（毫秒）
  configSnapshot: SimulationConfig  // 运行时的配置快照
}
```

---

## 3. 采样算法

### 3.1 PERT Beta 分布

使用项目管理标准的 **PERT Beta 分布**：

```typescript
/**
 * 从三点估算中采样一个随机工期
 * 
 * PERT 公式：
 *   期望值 E = (O + 4M + P) / 6
 *   标准差 σ = (P - O) / 6
 * 
 * 使用 Beta(α=4, β=4) 分布，映射到 [O, P] 区间
 */
function sampleFromThreePoint(
  optimistic: number,
  mostLikely: number,
  pessimistic: number,
  rng: () => number
): number {
  // 1. 使用 Beta 分布采样（0-1 之间）
  const beta = sampleBeta(4, 4, rng)
  
  // 2. 映射到 [O, P] 区间
  const duration = optimistic + beta * (pessimistic - optimistic)
  
  // 3. 四舍五入（工作日必须是整数）
  return Math.round(duration)
}

/**
 * Beta 分布采样（使用 Gamma 分布的比率方法）
 */
function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng)
  const y = sampleGamma(beta, rng)
  return x / (x + y)
}

/**
 * Gamma 分布采样（Marsaglia-Tsang 方法）
 */
function sampleGamma(alpha: number, rng: () => number): number {
  // 实现细节省略（标准算法）
}
```

### 3.2 随机数生成

```typescript
import seedrandom from 'seedrandom'

// 使用确定性随机数生成器（便于调试和复现）
const rng = seedrandom(Date.now().toString())
```

### 3.3 为整个项目采样

```typescript
/**
 * 为所有叶子任务生成一组随机工期
 */
function sampleProjectDurations(
  project: Project,
  config: SimulationConfig,
  rng: () => number
): Record<TaskId, number> {
  const durations: Record<TaskId, number> = {}
  
  for (const task of project.tasks) {
    // 跳过分组任务（工期由子任务决定）
    if (task.kind === 'group') continue
    
    const uncertainty = config.taskUncertainties[task.id]
    
    if (uncertainty) {
      // 用户设置了三点估算
      durations[task.id] = sampleFromThreePoint(
        uncertainty.optimistic,
        uncertainty.mostLikely,
        uncertainty.pessimistic,
        rng
      )
    } else {
      // 使用默认不确定性（±20%）
      const base = task.duration
      const opt = base * config.defaultUncertainty.optimisticFactor  // 0.8 × duration
      const pes = base * config.defaultUncertainty.pessimisticFactor // 1.2 × duration
      
      durations[task.id] = sampleFromThreePoint(opt, base, pes, rng)
    }
  }
  
  return durations
}
```

---

## 4. 模拟引擎

### 4.1 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    simulation.worker.ts                     │
│                                                              │
│  runSimulation(project, config) {                           │
│    finishDates = []                                         │
│                                                              │
│    for (i = 0; i < config.iterations; i++) {                │
│      // 1. 采样所有任务的随机工期                            │
│      sampledDurations = sampleProjectDurations(...)         │
│                                                              │
│      // 2. 创建临时项目副本（替换工期）                      │
│      sampledProject = {                                     │
│        ...project,                                          │
│        tasks: project.tasks.map(task => ({                  │
│          ...task,                                           │
│          duration: sampledDurations[task.id] ?? task.duration│
│        }))                                                   │
│      }                                                       │
│                                                              │
│      // 3. 调用完整 solve()，跳过资源平衡                   │
│      result = solve(sampledProject, {                       │
│        skipLeveling: true  // ← 关键参数                    │
│      })                                                      │
│                                                              │
│      // 4. 收集项目完工日期                                  │
│      finishDates.push(result.summary.projectFinish)         │
│                                                              │
│      // 5. 每 50 次迭代报告进度                              │
│      if (i % 50 === 0) postProgress(i, config.iterations)   │
│    }                                                         │
│                                                              │
│    // 6. 计算统计结果                                        │
│    return computeStatistics(finishDates, config)            │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                          │
                          ├─ import { solve } from '../scheduler/solve'
                          └─ 完全复用生产排期逻辑
```

### 4.2 solve() 的小修改

在 `domain/scheduler/solve.ts` 中新增 `skipLeveling` 选项：

```typescript
export function solve(
  project: Project,
  options?: {
    skipLeveling?: boolean  // ← 新增参数
  }
): ScheduleResult {
  // ... 现有逻辑 ...
  
  const ctx = buildScheduleContext(project)
  runForwardPass(ctx)
  runBackwardPass(ctx)
  
  // 在调用 levelLeaves 之前检查标志
  if (!options?.skipLeveling) {
    levelLeaves(ctx, project, ...)  // 原有的资源平衡调用
  }
  
  const summary = buildSummary(ctx)
  // ... 其余逻辑不变 ...
  
  return { summary, tasks: ctx.tasks, conflicts: [], ... }
}
```

**注意**：跳过资源平衡后，`result.conflicts` 可能为空（未检测资源超载），这在模拟场景下是预期行为。

### 4.3 Worker 消息协议

```typescript
// 请求消息
interface SimulationRequest {
  type: 'runSimulation'
  project: Project
  config: SimulationConfig
}

// 进度消息（每 50 次迭代发送一次）
interface SimulationProgress {
  type: 'progress'
  current: number      // 已完成迭代数
  total: number        // 总迭代数
  elapsed: number      // 已耗时（毫秒）
}

// 完成消息
interface SimulationComplete {
  type: 'complete'
  result: SimulationResult
}

// 取消消息
interface SimulationCancelled {
  type: 'cancelled'
}

// 错误消息
interface SimulationError {
  type: 'error'
  error: {
    message: string
    code: 'SIMULATION_FAILED' | 'TIMEOUT' | 'INVALID_CONFIG'
  }
}
```

### 4.4 统计计算

```typescript
/**
 * 从完工日期数组计算统计结果
 */
function computeStatistics(
  finishDates: DateStr[],
  config: SimulationConfig,
  startTime: number
): SimulationResult {
  const sorted = finishDates.slice().sort()
  const n = sorted.length
  
  return {
    timestamp: new Date().toISOString(),
    iterations: n,
    projectId: '...',
    finishDateDistribution: {
      dates: sorted,
      histogram: buildHistogram(sorted),
      percentiles: {
        p10: sorted[Math.floor(n * 0.1)],
        p50: sorted[Math.floor(n * 0.5)],   // 中位数
        p80: sorted[Math.floor(n * 0.8)],
        p90: sorted[Math.floor(n * 0.9)],
        p95: sorted[Math.floor(n * 0.95)]
      },
      mean: computeMeanDate(sorted),
      mode: computeMode(sorted)
    },
    duration: performance.now() - startTime,
    configSnapshot: config
  }
}

/**
 * 构建直方图（自动分箱）
 * 使用 Sturges' Rule: bins = ceil(log2(n) + 1)
 */
function buildHistogram(sortedDates: DateStr[]): Histogram {
  const n = sortedDates.length
  const binCount = Math.ceil(Math.log2(n) + 1)  // 通常 10-15 个箱
  
  const minDate = epochDay(sortedDates[0])
  const maxDate = epochDay(sortedDates[n - 1])
  const binWidth = Math.ceil((maxDate - minDate) / binCount)
  
  const bins: Array<{ start: DateStr; end: DateStr; count: number }> = []
  
  for (let i = 0; i < binCount; i++) {
    const binStart = minDate + i * binWidth
    const binEnd = binStart + binWidth
    
    const count = sortedDates.filter(d => {
      const day = epochDay(d)
      return day >= binStart && day < binEnd
    }).length
    
    bins.push({
      start: dayToIso(binStart),
      end: dayToIso(binEnd),
      count
    })
  }
  
  return { bins }
}
```

---

## 5. UI 设计

### 5.1 新增 Simulation 视图

在现有的四个视图（Gantt / Outline / Calendar / Resource）基础上，新增第五个视图：

```
TopBar: [Gantt] [Outline] [Calendar] [Resource] [Simulation]
```

### 5.2 Simulation 视图布局

```
┌─────────────────────────────────────────────────────────────┐
│  Simulation View                                             │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  配置区                                              │    │
│  │                                                       │    │
│  │  模拟精度：                                          │    │
│  │  ○ 快速 (500次, ~30秒)                              │    │
│  │  ● 标准 (1000次, ~60秒)                             │    │
│  │  ○ 精确 (5000次, ~5分钟)                            │    │
│  │                                                       │    │
│  │  默认不确定性：                                      │    │
│  │  乐观系数 [0.8] × 工期                              │    │
│  │  悲观系数 [1.2] × 工期                              │    │
│  │                                                       │    │
│  │  [运行模拟 ▶]                                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  结果区（初始为空，运行后显示）                      │    │
│  │                                                       │    │
│  │  项目完工日期概率分布                                │    │
│  │                                                       │    │
│  │   ▁▂▃▅▇█▇▅▃▂▁  ← 直方图                            │    │
│  │   │         ▲P50    ▲P80    ▲P95                    │    │
│  │   └───────────────────────────────────>             │    │
│  │     2026-06-10    -20      -28                      │    │
│  │                                                       │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐     │    │
│  │  │ P50 中位数 │ │ P80 置信度 │ │ P95 置信度 │     │    │
│  │  │ 2026-06-20 │ │ 2026-06-28 │ │ 2026-07-05 │     │    │
│  │  │            │ │ +8天缓冲   │ │ +15天缓冲  │     │    │
│  │  └────────────┘ └────────────┘ └────────────┘     │    │
│  │                                                       │    │
│  │  最后运行：2026-10-05 14:32                         │    │
│  │  迭代次数：1000  耗时：58.2秒                        │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 运行时进度对话框

点击"运行模拟"后，显示模态进度条（阻止用户编辑）：

```
┌─────────────────────────────────────┐
│  正在运行蒙特卡洛模拟...             │
│                                      │
│  [████████░░░░░░░░░░░] 450 / 1000   │
│                                      │
│  已耗时：26.3 秒                    │
│  预计剩余：32.5 秒                  │
│                                      │
│         [取消]                       │
└─────────────────────────────────────┘
```

### 5.4 任务三点估算编辑

在 Inspector 的任务 Tab 中，新增"不确定性"折叠组：

```
Inspector - 任务
├─ 基本信息
├─ 排期
├─ 不确定性  ← 新增
│  ├─ □ 为此任务设置三点估算
│  └─ （勾选后显示）
│      乐观工期： [  3  ] 天  ← 必须 ≤ 最可能
│      最可能工期：[  5  ] 天  (= 任务的 duration)
│      悲观工期： [  10 ] 天  ← 必须 ≥ 最可能
│      
│      ⚠️ 实时校验：乐观 > 悲观时显示红色提示
├─ 分配
└─ 备注
```

### 5.5 结果过期提示

当用户修改项目后（添加/删除任务、修改依赖、修改工期），Simulation 视图顶部显示黄色横幅：

```
⚠️ 模拟结果已过期（项目已于 14:45 修改），请重新运行
```

---

## 6. 状态管理

### 6.1 Zustand Store 扩展

```typescript
// src/store/store.ts

interface AppState {
  // ... 现有状态 ...
  project: Project
  scheduleResult: ScheduleResult | null
  
  // 新增：模拟相关状态
  simulationConfig: SimulationConfig
  simulationResult: SimulationResult | null
  simulationStatus: 'idle' | 'running' | 'completed' | 'error'
  simulationProgress: { current: number; total: number } | null
  simulationError: { message: string; code: string } | null
  
  // 新增：模拟相关 actions
  updateSimulationConfig: (config: Partial<SimulationConfig>) => void
  setTaskUncertainty: (taskId: TaskId, uncertainty: ThreePointEstimate | null) => void
  runSimulation: () => Promise<void>
  cancelSimulation: () => void
  clearSimulationResult: () => void
}
```

### 6.2 数据流

```
用户操作
  ↓
Store Action (runSimulation)
  ↓
simulationWorker.postMessage({
  type: 'runSimulation',
  project,
  config
})
  ↓
Worker 运行模拟
  ├─ 每 50 次迭代发送进度
  │   postMessage({ type: 'progress', current, total })
  ├─ Store 更新 simulationProgress
  └─ 模态进度条自动刷新
  ↓
Worker 完成
  postMessage({ type: 'complete', result })
  ↓
Store 更新
  ├─ simulationResult = result
  ├─ simulationStatus = 'completed'
  └─ simulationProgress = null
  ↓
Simulation 视图自动显示概率分布图
```

### 6.3 数据持久化

```typescript
// 存储到 IndexedDB（与 project 一起）
interface StoredProject {
  project: Project
  scheduleResult: ScheduleResult | null
  simulationConfig?: SimulationConfig      // ← 新增（始终持久化）
  simulationResult?: SimulationResult      // ← 可选（用户决定是否保存）
}
```

**持久化策略**：
- `simulationConfig` 始终持久化（用户设置的三点估算）
- `simulationResult` 默认**不持久化**（可能很大：1000 × 10 字节 ≈ 10KB）
- 未来可增加"导出模拟报告"功能（JSON / CSV）

---

## 7. 可视化实现

### 7.1 概率分布图组件

使用 **Recharts** 或 **D3.js**：

```typescript
// src/ui/simulation/DistributionChart.tsx

import { BarChart, Bar, XAxis, YAxis, ReferenceLine, ResponsiveContainer } from 'recharts'

interface DistributionChartProps {
  result: SimulationResult
}

export function DistributionChart({ result }: DistributionChartProps) {
  const { histogram, percentiles } = result.finishDateDistribution
  
  return (
    <div className="distribution-chart">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={histogram.bins}>
          <XAxis 
            dataKey="start" 
            tickFormatter={formatDate}
            label={{ value: '完工日期', position: 'insideBottom', offset: -5 }}
          />
          <YAxis 
            label={{ value: '频数', angle: -90, position: 'insideLeft' }} 
          />
          <Bar dataKey="count" fill="#3b82f6" />
          
          {/* 百分位标线 */}
          <ReferenceLine 
            x={percentiles.p50} 
            stroke="#10b981" 
            strokeWidth={2}
            label={{ value: 'P50', position: 'top' }}
          />
          <ReferenceLine 
            x={percentiles.p80} 
            stroke="#f59e0b" 
            strokeWidth={2}
            label={{ value: 'P80', position: 'top' }}
          />
          <ReferenceLine 
            x={percentiles.p95} 
            stroke="#ef4444" 
            strokeWidth={2}
            label={{ value: 'P95', position: 'top' }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
```

### 7.2 关键指标卡片

```typescript
// src/ui/simulation/MetricCard.tsx

interface MetricCardProps {
  label: string
  value: DateStr
  delta?: string  // 例如："+8天"
  color: 'green' | 'yellow' | 'red'
}

export function MetricCard({ label, value, delta, color }: MetricCardProps) {
  const colorClasses = {
    green: 'border-green-500 bg-green-50',
    yellow: 'border-yellow-500 bg-yellow-50',
    red: 'border-red-500 bg-red-50'
  }
  
  return (
    <div className={`metric-card ${colorClasses[color]}`}>
      <div className="label">{label}</div>
      <div className="value">{formatDate(value)}</div>
      {delta && <div className="delta">{delta} 风险缓冲</div>}
    </div>
  )
}
```

### 7.3 日期差异计算

```typescript
/**
 * 计算两个日期之间的日历天数差（用于显示风险缓冲）
 */
function dateDiff(from: DateStr, to: DateStr): string {
  const days = epochDay(to) - epochDay(from)
  return days > 0 ? `+${days}天` : `${days}天`
}
```

---

## 8. 错误处理

### 8.1 错误场景

| 错误类型 | 检测位置 | 处理策略 |
|---------|---------|---------|
| 循环依赖 | solve() 函数 | Worker 捕获错误，返回 error 消息 |
| 无效工期（< 0 或 NaN） | 采样函数 | 钳制到 [0.1, Infinity] |
| Worker 崩溃 | 主线程 | 60 秒超时，显示"模拟超时" |
| 内存溢出 | Worker | 不太可能（5000 × 10KB = 50KB） |
| 三点估算不合理（O > P） | Inspector 输入 | 实时校验，红色提示，禁用"运行" |

### 8.2 边界情况

| 场景 | 处理 |
|------|------|
| 项目无任务 | 禁用"运行模拟"按钮，显示提示"项目为空" |
| 所有任务都是手动排期 | 显示警告："所有任务工期固定，模拟结果无意义" |
| 模拟中途取消 | Worker 每 10 次迭代检查取消标志 |
| 模拟结果过期 | 顶部黄色横幅："结果已过期，请重新运行" |

### 8.3 取消机制

```typescript
// 主线程
let simulationWorker: Worker | null = null
let cancelRequested = false

async function runSimulation() {
  cancelRequested = false
  simulationWorker = new Worker(new URL('./simulation.worker.ts', import.meta.url))
  
  simulationWorker.postMessage({
    type: 'runSimulation',
    project,
    config
  })
  
  // 60 秒超时
  const timeout = setTimeout(() => {
    cancelSimulation()
    showError('模拟超时，请减少迭代次数或任务数')
  }, 60000)
}

function cancelSimulation() {
  cancelRequested = true
  simulationWorker?.postMessage({ type: 'cancel' })
}

// Worker 中
let cancelled = false

self.onmessage = (e) => {
  if (e.data.type === 'cancel') {
    cancelled = true
    return
  }
  
  // ... 模拟循环 ...
  for (let i = 0; i < iterations; i++) {
    // 每 10 次迭代检查取消标志
    if (i % 10 === 0 && cancelled) {
      self.postMessage({ type: 'cancelled' })
      return
    }
    
    // ... 采样和求解 ...
  }
}
```

---

## 9. 测试策略

### 9.1 单元测试

**采样算法测试** (`domain/simulation/sampling.test.ts`)：
- ✅ 三点估算采样应落在 [O, P] 区间内（1000 次采样验证）
- ✅ 相同种子应产生相同序列（可复现性）
- ✅ 默认不确定性应正确应用（±20% 验证）
- ✅ Beta 分布的均值应接近 PERT 期望值

**统计计算测试** (`domain/simulation/statistics.test.ts`)：
- ✅ 百分位计算应准确（P50 = 中位数）
- ✅ 直方图分箱数应合理（Sturges' Rule）
- ✅ P10 < P50 < P90 的单调性
- ✅ 边界情况：所有日期相同时的处理

### 9.2 集成测试

**完整模拟流程测试** (`domain/simulation/simulation.integration.test.ts`)：
- ✅ 应能完整运行 100 次迭代（小规模快速验证）
- ✅ 应正确跳过资源平衡（模拟 P50 ≤ 正常求解）
- ✅ 取消机制应正确工作
- ✅ 错误场景：循环依赖、无效工期

### 9.3 E2E 测试

**用户完整流程测试** (`tests/e2e/simulation.spec.ts`)：
1. 创建测试项目（10 个任务）
2. 切换到 Simulation 视图
3. 为任务设置三点估算
4. 运行快速模拟（500 次）
5. 验证进度条显示
6. 验证结果图表渲染
7. 验证 P50/P80/P95 数值格式

---

## 10. 性能预期

### 10.1 基准数据

基于现有 `solve()` 的性能（500 叶子 + 15 资源）：
- 单次求解：~58ms（包含完整 CPM + 约束检测）
- 跳过资源平衡后：预计 ~40-50ms（节省 levelLeaves 时间）

### 10.2 模拟耗时估算

| 迭代次数 | 单次耗时 | 总耗时 | 适用场景 |
|---------|---------|--------|---------|
| 500 次 | 45ms | ~22.5 秒 | 快速验证 |
| 1000 次 | 45ms | ~45 秒 | 标准分析 |
| 5000 次 | 45ms | ~225 秒 | 精确报告 |

**注意**：
- 实际耗时取决于项目规模（任务数、依赖复杂度）
- 大型项目（1000+ 任务）可能需要更长时间
- 进度条会实时显示预计剩余时间

### 10.3 优化空间（未来）

1. **并行模拟**：使用多个 Worker 并行运行（需要协调结果汇总）
2. **增量采样**：先跑 100 次，检查收敛性，再决定是否继续
3. **轻量 CPM**：抽取最小 CPM 子集（但需维护两套代码）

---

## 11. 实施路线图

### 阶段 1：核心引擎（5-7 天）
- [ ] 实现采样算法（`sampling.ts`）
- [ ] 实现统计计算（`statistics.ts`）
- [ ] 创建 `simulation.worker.ts`
- [ ] 修改 `solve()` 增加 `skipLeveling` 选项
- [ ] 单元测试 + 集成测试

### 阶段 2：数据层（2-3 天）
- [ ] 扩展 Zustand store（SimulationConfig / Result）
- [ ] 实现 actions（runSimulation / cancelSimulation）
- [ ] 数据持久化到 IndexedDB

### 阶段 3：UI 实现（5-7 天）
- [ ] 新增 Simulation 视图（路由 + 基础布局）
- [ ] 实现配置区（迭代次数选择、默认不确定性设置）
- [ ] 实现概率分布图（Recharts / D3.js）
- [ ] 实现关键指标卡片
- [ ] 实现运行进度对话框

### 阶段 4：任务编辑（2-3 天）
- [ ] Inspector 中新增"不确定性"折叠组
- [ ] 三点估算输入表单
- [ ] 实时校验（O ≤ M ≤ P）

### 阶段 5：错误处理与优化（3-4 天）
- [ ] 错误捕获与用户提示
- [ ] 取消机制
- [ ] 结果过期检测
- [ ] E2E 测试

### 阶段 6：文档与发布（1-2 天）
- [ ] 用户文档（如何使用蒙特卡洛模拟）
- [ ] API 文档（SimulationConfig / Result 接口）
- [ ] 发布说明

**总计**：约 3-4 周（一人全职）

---

## 12. 未来扩展（不在初版范围）

### 12.1 高风险任务识别

**目标**：找出"对项目工期影响最大"的任务（敏感性分析）。

**实现思路**：
```typescript
// 为每个任务运行两组模拟：
// 1. 任务 A 工期固定为最可能值
// 2. 任务 A 工期按三点估算采样

// 对比两组模拟的项目完工日期方差
const sensitivity = variance(withSampling) - variance(withoutSampling)

// 按敏感性排序，识别前 10 名高风险任务
```

**工作量**：约 1 周（需要 N+1 组模拟，N = 任务数）

### 12.2 关键路径的不确定性

**目标**：显示"任务 A→B→C 有 65% 概率是关键路径"。

**实现思路**：
```typescript
// 每次模拟记录关键路径
const criticalPaths: Record<string, number> = {}

for (each simulation) {
  const path = extractCriticalPath(result)
  const pathKey = path.map(t => t.id).join('→')
  criticalPaths[pathKey]++
}

// 按频率排序
const ranked = Object.entries(criticalPaths)
  .sort((a, b) => b[1] - a[1])
  .map(([path, count]) => ({ path, probability: count / iterations }))
```

**工作量**：约 3 天

### 12.3 任务相关性

**目标**：某些任务的工期可能相关（例如：同一团队负责的任务）。

**实现思路**：
- 引入相关系数矩阵 `ρ[i, j]`
- 使用 Cholesky 分解生成相关的随机样本

**工作量**：约 1 周（数学复杂度高）

### 12.4 导出功能

- 导出 PDF 报告（概率分布图 + 关键指标）
- 导出 CSV（所有模拟的完工日期，用于外部分析）

**工作量**：约 2-3 天

---

## 13. 附录

### 13.1 参考资料

- **PERT 方法**：Program Evaluation and Review Technique（美国海军 1958 年）
- **Beta 分布**：项目管理标准的不确定性建模方法
- **蒙特卡洛模拟**：@Risk、Crystal Ball 等商业软件的核心算法

### 13.2 术语表

| 术语 | 解释 |
|------|------|
| 三点估算 | 乐观 (O) / 最可能 (M) / 悲观 (P) 工期 |
| PERT | Program Evaluation and Review Technique |
| P50 | 50% 分位数（中位数），有 50% 概率在此日期前完工 |
| P80 | 80% 分位数，有 80% 概率在此日期前完工 |
| 风险缓冲 | P80 - P50，用于应对不确定性的额外时间 |
| CPM | Critical Path Method，关键路径法 |

---

**设计文档结束**

下一步：审核此文档 → 调用 writing-plans skill 生成实施计划
