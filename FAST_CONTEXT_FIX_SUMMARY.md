# Fast Context "0 Results" 问题修复总结

## 问题诊断

Fast Context 子代理经常返回 "0 results"，即使工具调用（grep、read_file、find_files）明确找到并读取了相关文件。

### 根本原因

1. **最终轮仍允许工具调用** - `callLLM` 始终发送 `tools` 和 `tool_choice: "auto"`，导致 LLM 在被要求给出最终答案时仍然尝试调用工具而非输出 JSON
2. **JSON 解析脆弱** - 正则表达式 `[\s\S]*?` (lazy匹配) 无法处理嵌套的 contexts 数组，遇到代码片段中的 `]` 时提前截断
3. **超时问题** - 所有调用使用相同的 30 秒超时，最终答案调用需要更长时间
4. **LLM 输出格式不严格** - 许多模型不严格遵循 JSON 格式指令
5. **成功的工具调用结果丢失** - 当 LLM 最终响应解析失败时，已读取的文件内容被完全丢弃

---

## 实施的 6 个修复

### ✅ Fix 1: `callLLM` 增加 `noTools` 和 `jsonResponse` 参数

**位置**: `FastContextAgent.ts:377-471`

**改动**:
```typescript
private async callLLM(messages: any[], options?: { noTools?: boolean; jsonResponse?: boolean })
```

- 当 `options.noTools = true` 时，不发送 `tools`、`tool_choice`、`parallel_tool_calls`
- 当 `options.jsonResponse = true` 时，添加 `response_format: { type: "json_object" }`
- 在 maxTurns 耗尽后的最终调用中使用: `callLLM(messages, { noTools: true, jsonResponse: true })`

**效果**: LLM 被强制返回纯文本 JSON 答案，而不是继续调用工具

---

### ✅ Fix 2: 最后一轮增加提早结束提示

**位置**: `FastContextAgent.ts:216-223`

**改动**:
```typescript
const isLastTurn = turn === this.config.maxTurns - 1
if (isLastTurn && turn > 0) {
    messages.push({
        role: "user",
        content: "This is your LAST turn. If you have gathered enough information, provide your final JSON answer now instead of making more tool calls.",
    })
}
```

**效果**: 在最后一轮开始前警告 LLM，如果已有足够信息，应直接给出答案而非继续搜索

---

### ✅ Fix 3: 改进 `parseContextsFromResponse` 鲁棒性

**位置**: `FastContextAgent.ts:475-584`

**改动**:
- **Strategy 1**: Markdown 代码围栏提取（保持不变）
- **Strategy 2**: 直接解析整个内容为 JSON（适用于 `response_format: json_object`）
- **Strategy 3 (新增)**: **括号匹配提取** - 使用状态机正确处理嵌套的 `{}`、`[]`、字符串转义
- **Strategy 4 (新增)**: 仅提取 `contexts` 数组并解析
- **Fallback**: 文件路径模式匹配（增加了 `http:` 过滤）

**关键新方法**:
```typescript
private extractJsonByBracketMatching(content: string, openChar = "{", closeChar = "}")
```
使用栈式深度追踪和字符串状态管理，比正则更可靠。

**效果**: 可以正确解析包含复杂嵌套对象和代码片段的 JSON

---

### ✅ Fix 4: 最终调用使用 `response_format`

**位置**: `FastContextAgent.ts:401-403`

**改动**:
```typescript
if (options?.jsonResponse) {
    body.response_format = { type: "json_object" }
}
```

在 line 350 的最终调用中启用:
```typescript
const finalResponse = await this.callLLM(messages, { noTools: true, jsonResponse: true })
```

**效果**: OpenAI 兼容的 API 会强制 LLM 输出有效 JSON，而非自然语言

---

### ✅ Fix 5: 从工具历史构建结果作为 fallback

**位置**: `FastContextAgent.ts:593-625`

**新增方法**:
```typescript
private buildContextsFromToolHistory(turns: FastContextTurn[]): FastContextFileContext[]
```

**逻辑**:
1. 遍历所有 turn 的 toolCalls
2. 筛选 `tool === "read_file"` 且结果不是错误的调用
3. 提取文件路径、行号、内容
4. 截断到前 50 行避免上下文过大
5. 标记为 "Retrieved from tool history (LLM response parsing failed)"

**调用位置**:
- Line 240-242: 当 LLM 提前结束但响应解析失败时
- Line 354-356: 当 maxTurns 耗尽且最终响应解析失败时
- Line 375-393: 当发生错误（超时/API 失败）时

**效果**: 即使 LLM 最终答案格式错误，已读取的文件内容也不会丢失

---

### ✅ Fix 6: Per-call 超时策略

**位置**: `FastContextAgent.ts:405-411`

**改动**:
```typescript
const timeoutMs = options?.noTools
    ? Math.max(this.config.timeoutSeconds * 1000, 60000)  // 最终调用至少 60s
    : this.config.timeoutSeconds * 1000                   // 工具调用使用配置值
```

**效果**: 最终答案调用有更长的超时时间（至少 60 秒），避免在生成 JSON 时被截断

---

## 修改文件清单

| 文件 | 改动行数 | 说明 |
|------|---------|------|
| `FastContextAgent.ts` | ~200 行 | 核心修复 |
| `CodebaseSearchToolHandler.ts` | 0 行 | 无需修改，自动受益 |

---

## 预期效果

### 修复前
```
Fast Context — 32.9s — 0 results
✓ Finding GeneralSettingsSection* in extensions/shuncode (69ms)
✓ Grepping preferredLanguage in extensions/shuncode (2.5s)
✓ Grepping GeneralSettingsSection in extensions/shuncode (2.5s)
✓ Reading extensions/shuncode/webview-ui/src/components/settings/... (1ms × 3)
```
**问题**: 工具明确找到了文件，但最终返回 0 结果

### 修复后
```
Fast Context — 15.2s — 3 results
✓ Finding GeneralSettingsSection* in extensions/shuncode (69ms)
✓ Grepping GeneralSettingsSection in extensions/shuncode (2.5s)
✓ Reading extensions/shuncode/webview-ui/src/components/settings/GeneralSettingsSection.tsx (1ms)
✓ Reading extensions/shuncode/webview-ui/src/components/settings/index.ts (1ms)

Found 3 relevant sections:
- extensions/shuncode/webview-ui/src/components/settings/GeneralSettingsSection.tsx:1-120
- extensions/shuncode/webview-ui/src/components/settings/index.ts:5-8
- extensions/shuncode/webview-ui/src/components/settings/SettingsView.tsx:45-67
```

### 关键改进

1. **✅ 0 results → 实际结果** - fallback 机制确保读取的文件不会丢失
2. **⚡ 更快完成** - 提早结束提示减少不必要的轮次
3. **🛡️ 超时保护** - 最终调用有独立的 60s 超时
4. **🎯 强制 JSON** - `response_format: json_object` 提高成功率
5. **🔍 更好的解析** - 括号匹配算法处理复杂嵌套

---

## 测试建议

### 1. 基础场景测试
```
Fast Context: "Find the GeneralSettingsSection component"
```
**预期**: 应返回 GeneralSettingsSection.tsx 的内容，不再是 0 results

### 2. 嵌套代码测试
```
Fast Context: "Find TypeScript interfaces with nested arrays and objects"
```
**预期**: Strategy 3 括号匹配应正确解析包含 `[]` 的代码片段

### 3. 超时场景测试
- 设置 `timeoutSeconds: 10`
- 搜索大型代码库
**预期**: 工具调用可能超时，但最终答案调用仍有 60s 窗口

### 4. LLM 不遵循格式测试
- 使用廉价模型（如 llama-3.2）
- 搜索任意代码
**预期**: 即使 LLM 返回自然语言而非 JSON，fallback 应从工具历史提取结果

### 5. API 错误恢复测试
- 模拟 API 失败（断网、错误的 API key）
**预期**: 如果已成功执行 read_file，应返回 salvaged 结果而非完全失败

---

## 回滚方案

如果新实现出现问题，可以通过 git 恢复：

```bash
git checkout HEAD~1 -- extensions/shuncode/src/core/fast-context/FastContextAgent.ts
```

或者禁用关键 fix：
1. **禁用 Fix 1**: 移除 `{ noTools: true, jsonResponse: true }` 参数
2. **禁用 Fix 5**: 注释掉 `buildContextsFromToolHistory` 调用

---

## 后续优化方向

### 短期
- [ ] 添加 metrics 收集：parseContext 成功率、fallback 触发率
- [ ] UI 中标记来自 fallback 的结果

### 中期
- [ ] 支持流式返回部分结果（不等待所有轮完成）
- [ ] 智能轮次停止（检测到 read_file 成功后主动结束）

### 长期
- [ ] 使用专门的 code embedding 模型预过滤
- [ ] 自适应选择 LLM（简单查询用快速模型，复杂查询用高质量模型）

---

## 相关文档

- **系统提示词**: `FastContextAgent.ts:110-159`
- **工具定义**: `FastContextAgent.ts:26-108`
- **配置选项**: `src/shared/FastContextTypes.ts:36-62`

---

**修复完成时间**: 2026-06-18  
**测试状态**: 待验证  
**风险等级**: 低（所有改动向后兼容，增加 fallback 机制）
