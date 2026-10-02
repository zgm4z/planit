# Planit

Web 版 OmniPlan —— 以依赖驱动排期为核心的甘特图项目管理工具。

## 特性

- 任务树（摘要任务 / 子任务 / 里程碑），摘要日期自动汇总
- 四种依赖类型（FS / SS / FF / SF）+ 正负延迟
- CPM 求解：改任一任务，下游链路自动重排，关键路径实时高亮
- 可配置工作日历（周工作日 + 节假日例外），改日历全盘重算
- 拖拽排期：平移 / 改工期 / 改开始日期，落点自动吸附工作日
- 完整撤销 / 重做（命令模型 + Immer 自动生成正向与逆向 patch）
- 数据存于浏览器 IndexedDB，自动存盘
- 界面支持中文 / English / 日本語

## 技术栈

React 19 · TypeScript · Vite · Mantine 9 · SCSS Modules · react-i18next ·
Zustand · Immer · @tanstack/react-virtual · date-fns

## 开发

```bash
pnpm install
pnpm dev        # 开发服务器（默认 5173；e2e 固定在 5174）
pnpm test       # 单元测试（vitest）
pnpm typecheck  # 类型检查
pnpm build      # 生产构建
pnpm e2e        # 端到端验收（Playwright，需先 pnpm exec playwright install chromium）
```

`scripts/` 是开发辅助脚本，不进构建产物：

- `seedLargeProject.ts` —— 生成 1000 任务的压测项目（`perf.spec.ts` 用）。
- `importOmniPlan.py` —— 把真实 OmniPlan 文档（`.oplx`）转成 planit 的
  `Project` JSON（`schemaVersion` 与当前 `SCHEMA_VERSION` 一致），
  用于拿真实数据实测排期引擎。纯标准库、无依赖：

  ```bash
  python3 scripts/importOmniPlan.py path/to/xxx.oplx -o out.json
  ```

  导入是**单向且有损**的：OmniPlan 的资源平衡结果 `leveled-start` 不会带过来，
  planit 会用自己的 CPM 重算 —— 两边日期的差异正是实测要观察的东西。

## 架构

```
View  (React + Mantine)    ← 只 dispatch 命令，不直接写 store
  ↓
Command (命令注册表)        ← 所有数据变更的唯一入口
  ↓
Store  (Zustand + Immer)   ← 命令 + 正/逆向 patch 双栈
  ↓
Domain (纯 TypeScript)     ← 模型 / 日历 / CPM 求解，零 React 依赖
  ↓
Persist (IndexedDB)        ← 防抖自动存盘
```

调度引擎（`src/domain/scheduler`）是纯函数，可脱离 UI 单独测试 ——
排期正确性由单元测试保证，UI 只需验证「操作后数据对不对」。

## 关于 UI 层的两个约定

**Mantine 与自研的边界**：工具栏、表单、弹层、布局原语用 Mantine；
甘特图区域（刻度尺、网格、任务条、依赖连线、任务树行）自研，
用 SCSS Modules + 绝对定位 + SVG。这些区域需要像素级控制和虚拟滚动，
组件库会碍事。

**i18n**：所有用户可见文案都走 `t()`。命令的 `label` 字段存的是 i18n key
（如 `commands.task.create`），UI 渲染撤销提示时才翻译 ——
这样命令层保持语言无关。

## 端到端验收（e2e/）

前一阶段的 UI 验收是临时的 `browser_evaluate` 断言，验完即弃、没有回归保护。
`e2e/` 把它们固化成了可重跑的 Playwright 测试：

- `regression.spec.ts` —— 6 类曾经真实发生过的微妙缺陷（左右行对齐、
  sticky 左列钉住、连接柄/把手可点、依赖连线端点、拖拽中 store 不变、
  底纹跟随日历）。每条都用**独立于实现**的期望值（DOM 几何或手算日期），
  且已用「重新引入缺陷」的方式验证过确实会变红。
- `acceptance.spec.ts` —— 设计文档第 12 节的验收标准中可自动化的部分。
- `perf.spec.ts` —— 1000 / 2000 任务压测（滚动帧率、改日历同步阻塞）。
- `known-limitations.spec.ts` —— 「已知限制」的表征测试，修好后会立刻变红。

```bash
pnpm e2e                                  # 全部
pnpm e2e regression.spec.ts               # 只跑回归
pnpm e2e -g "底纹跟随用户日历"             # 按标题过滤
```

## 已知限制

> **注意**：本节的三条限制都有对应的表征测试（`e2e/known-limitations.spec.ts`）。
> 修复其中任何一条时，请同步删除该测试与本节对应条目 —— 否则测试会变红而你需要知道那是**预期的**。

以下三条均经实测（`e2e/perf.spec.ts` 与 `e2e/known-limitations.spec.ts`
可复现），属第一阶段有意保留、未处理的问题。

### 1. 大项目下的重算卡顿

1000 任务 / 999 依赖（`scripts/seedLargeProject.ts`）时，改动一次工作日历
会让主线程同步阻塞到下一帧约 **210ms**（2000 任务约 **290ms**）。

分解（本机 headless Chromium 实测）：

| 部分 | 耗时 |
|---|---|
| `solve()` 纯求解 | ≈ 16ms |
| store 侧同步更新 + 强制回流 | ≈ 17ms |
| **其余 ≈ 190ms：`ProjectView` 的重渲染** | |
| ↳ 其中非工作日底纹一节 | ≈ 97ms |
| ↳ 其余（全量行的几何 memo + 时间轴） | ≈ 97ms |

主要成本不在 CPM 求解，而在重渲染：这条 1000 节点长链把时间轴拉到约
4200 天，光是「非工作日底纹」就产生 **1200 个 DOM 节点**——把日历临时改成
「每天都是工作日」后，阻塞立刻降到 ≈ 113ms。store 侧本身很轻（solve 十几毫秒）。

**结论**：属第一阶段已知性能天花板，未优化。后续方向：底纹改为 canvas /
单层渐变、`rectByTaskId` 与时间轴按可见范围分片、长链场景下调 `overscan`。

> 早前另一次基准（不同机器 / 项目形状）测得 1000 任务约 114ms、2000 任务约
> 215ms。绝对数字随机器与时间轴跨度变化，量级为**数百毫秒**。

### 2. `finishOn` 影子可能早于项目起点

当一个任务的 `finishOn` 约束使其开始日期**早于 `project.startDate`** 时，
它的任务条会落到时间轴原点左侧（`left` 为负），被 sticky 左列盖住。

例：项目起点 `2026-03-02`，某任务工期 3、`finishOn 2026-03-03`，
反推开始日为 `2026-02-27` —— 比原点早 3 个自然日，任务条画在 `x = -96px`。

这是**预存在**的行为：时间轴原点固定为 `project.startDate`，任何排期早于
项目起点的任务（不止 `finishOn`，还有可能由负 lag 造成）都会被盖住。
第一阶段未处理。`e2e/known-limitations.spec.ts` 固化了当前行为作为证据。

### 3. 列宽不支持键盘调整

大纲视图的列宽只能靠鼠标 / 触控拖动表头分隔线调整，双击可复位单列，
但没有任何键盘入口（手柄是 `role="separator"` 的 `div`，没有 `tabindex`）。
宽度偏好存于 `localStorage` 的 `planit.outlineColumnWidths`，不进项目文件、
不进撤销栈。

## 范围

当前为第一阶段（地基）：任务树 + 甘特图 + 依赖调度。

资源分配、基线对比、成本核算见设计文档
`docs/superpowers/specs/2026-10-01-omniplan-web-design.md`。
