# Task Evaluation 模块

## 概述

本模块负责对 AI 任务执行过程进行质量评估。它通过采集任务执行期间的各类信号，自动计算质量分数、等级和发现项（findings），帮助系统判断任务完成质量并决定是否需要后续跟进。

## 核心组件

### TaskEvaluationTracker

主跟踪器类，贯穿任务生命周期收集评估信号：

- **工具使用追踪**：记录工具调用次数、失败次数、拒绝次数、编辑和命令操作次数。
- **验证证据采集**：识别测试、lint、typecheck、build、diagnostics 等验证命令，判断任务是否具备验证闭环。
- **异常行为检测**：模式违规、参数缺失、权限拒绝、重复失败循环、探索告警等。
- **用户反馈记录**：支持 thumbs_up / thumbs_down 反馈信号。
- **任务进度解析**：从 markdown checklist 中提取进度完成比例。

### 评分机制

基于采集的信号，使用加减分规则计算 0–100 分，并映射为等级：

| 分数范围 | 等级 |
|---------|------|
| 90–100  | excellent |
| 75–89   | good |
| 50–74   | needs_attention |
| 0–49    | failed |

### types.ts

定义所有评估相关类型：

- `TaskEvaluationSignals` — 原始信号数据
- `TaskEvaluationFinding` — 单条发现项（含严重级别和消息）
- `TaskEvaluationSummary` — 轻量摘要（用于持久化和展示）
- `TaskEvaluation` — 完整评估结果（含信号和发现项）
- `TaskVerificationCommand` — 验证命令记录

## 使用方式

```typescript
import { TaskEvaluationTracker } from "./evaluation"

const tracker = new TaskEvaluationTracker()
tracker.start({ taskId: "task-123" })

// 任务执行过程中持续记录
tracker.recordToolUse({ toolName: "write_to_file", status: "success" })
tracker.recordCompletionAttempt("- [x] step1\n- [ ] step2")

// 任务结束时生成评估
const evaluation = tracker.finalize()
// evaluation.score, evaluation.grade, evaluation.findings
```

## 文件结构

```
evaluation/
├── index.ts                    # 模块导出
├── TaskEvaluationTracker.ts    # 主跟踪器与评分逻辑
├── types.ts                    # 类型定义
└── __tests__/
    └── TaskEvaluationTracker.test.ts  # 单元测试
```

