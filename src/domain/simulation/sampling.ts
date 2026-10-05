import type { Project, TaskId, TaskUncertainty } from '../model/types'

/**
 * 使用 PERT Beta 分布从三点估算中采样一个随机工期。
 *
 * PERT (Program Evaluation and Review Technique) 使用 Beta 分布
 * 对项目工期的不确定性建模：
 * - O (乐观): 最好情况下的工期
 * - M (最可能): 最常见的工期
 * - P (悲观): 最坏情况下的工期
 *
 * Beta 分布的期望值为 E = (O + 4M + P) / 6
 *
 * @param optimistic - 乐观工期（工作日）
 * @param mostLikely - 最可能工期（工作日）
 * @param pessimistic - 悲观工期（工作日）
 * @param rng - 随机数生成器函数，返回 [0, 1) 的随机数
 * @returns 采样得到的工期（工作日）
 */
export function sampleFromBeta(
  optimistic: number,
  mostLikely: number,
  pessimistic: number,
  rng: () => number
): number {
  // 验证输入
  if (optimistic > mostLikely || mostLikely > pessimistic) {
    throw new Error(
      `Invalid three-point estimates: O=${optimistic}, M=${mostLikely}, P=${pessimistic}`
    )
  }

  // 边界情况：如果三个值相等，直接返回
  if (optimistic === pessimistic) {
    return optimistic
  }

  // PERT 使用特定的 Beta 分布参数
  // λ 控制分布的形状，标准 PERT 使用 λ = 4
  const lambda = 4
  const range = pessimistic - optimistic

  // PERT Beta 分布参数：
  // α = 1 + λ * (M - O) / (P - O)
  // β = 1 + λ * (P - M) / (P - O)
  // 这样期望值 E[X] = α / (α + β) 在 [0,1] 空间映射后
  // 约等于 (O + λM + P) / (λ + 2) ≈ (O + 4M + P) / 6
  const alpha = 1 + lambda * ((mostLikely - optimistic) / range)
  const beta = 1 + lambda * ((pessimistic - mostLikely) / range)

  // 使用 Cheng's rejection sampling 算法生成 Beta(α, β) 样本
  // 这是一个高效的通用 Beta 分布采样方法
  const betaSample = sampleBetaDistribution(alpha, beta, rng)

  // 将 [0, 1] 的 Beta 样本映射到 [O, P] 区间
  return optimistic + betaSample * range
}

/**
 * 采样 Beta(α, β) 分布。
 *
 * 使用两个独立 Gamma 分布的比值：X ~ Gamma(α, 1), Y ~ Gamma(β, 1)
 * 则 X / (X + Y) ~ Beta(α, β)
 *
 * 这个方法简单可靠，对任意 α > 0, β > 0 都有效。
 *
 * @param alpha - Beta 分布的 α 参数
 * @param beta - Beta 分布的 β 参数
 * @param rng - 随机数生成器
 * @returns [0, 1] 区间的 Beta 分布样本
 */
function sampleBetaDistribution(
  alpha: number,
  beta: number,
  rng: () => number
): number {
  // 对于 α = β = 1（均匀分布），直接返回随机数
  if (alpha === 1 && beta === 1) {
    return rng()
  }

  // 使用两个 Gamma 分布的比值
  const x = sampleGamma(alpha, rng)
  const y = sampleGamma(beta, rng)
  return x / (x + y)
}

/**
 * 采样 Gamma(shape, 1) 分布。
 *
 * 使用 Marsaglia and Tsang's method（α >= 1）或递归降阶（α < 1）。
 *
 * @param shape - Gamma 分布的形状参数 α
 * @param rng - 随机数生成器
 * @returns Gamma 分布样本
 */
function sampleGamma(shape: number, rng: () => number): number {
  // 对于 α < 1，使用递归：Gamma(α) = Gamma(α+1) * U^(1/α)
  if (shape < 1) {
    return sampleGamma(shape + 1, rng) * Math.pow(rng(), 1 / shape)
  }

  // Marsaglia and Tsang's method (适用于 α >= 1)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)

  while (true) {
    // 生成标准正态随机数
    let x: number
    let v: number

    do {
      x = sampleNormal(rng)
      v = 1 + c * x
    } while (v <= 0)

    v = v * v * v
    const u = rng()
    const x2 = x * x

    // 快速接受
    if (u < 1 - 0.0331 * x2 * x2) {
      return d * v
    }

    // 慢速接受/拒绝
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) {
      return d * v
    }
  }
}

/**
 * 使用 Box-Muller 变换生成标准正态分布 N(0, 1) 样本。
 *
 * @param rng - 随机数生成器
 * @returns 标准正态分布样本
 */
function sampleNormal(rng: () => number): number {
  // 避免 log(0)
  let u1: number
  do {
    u1 = rng()
  } while (u1 === 0)

  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * 为项目中的所有任务采样随机工期。
 *
 * 对于有不确定性参数的任务，使用 PERT Beta 分布采样；
 * 对于没有不确定性参数的任务，使用确定性工期。
 *
 * @param project - 项目数据
 * @param uncertainties - 任务不确定性参数数组
 * @param rng - 随机数生成器
 * @returns 任务 ID 到采样工期的映射
 */
export function sampleProjectDurations(
  project: Project,
  uncertainties: TaskUncertainty[],
  rng: () => number
): Record<TaskId, number> {
  // 构建任务不确定性查找表
  const uncertaintyMap = new Map<TaskId, TaskUncertainty>()
  for (const u of uncertainties) {
    uncertaintyMap.set(u.taskId, u)
  }

  const sampledDurations: Record<TaskId, number> = {}

  // 遍历所有任务
  for (const taskId of Object.keys(project.tasks)) {
    const task = project.tasks[taskId]
    const uncertainty = uncertaintyMap.get(taskId)

    if (uncertainty) {
      // 有不确定性参数，使用 PERT Beta 采样
      sampledDurations[taskId] = sampleFromBeta(
        uncertainty.optimistic,
        uncertainty.mostLikely,
        uncertainty.pessimistic,
        rng
      )
    } else {
      // 没有不确定性参数，使用确定性工期
      sampledDurations[taskId] = task.duration
    }
  }

  return sampledDurations
}

/**
 * 创建一个可复现的伪随机数生成器。
 *
 * 使用 Mulberry32 算法，这是一个简单但足够好的 PRNG。
 *
 * @param seed - 随机种子（任意数字）
 * @returns 随机数生成器函数
 */
export function createSeededRng(seed: number): () => number {
  let state = seed

  return function () {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 将字符串种子转换为数字种子。
 *
 * @param seed - 字符串种子
 * @returns 数字种子
 */
export function hashSeed(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}
