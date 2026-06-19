# 多接口配置管理系统 - 架构设计文档

## 1. 系统概述

### 1.1 目标
设计并实现一个灵活、可扩展的多接口配置管理系统，允许用户在 Shuncode 中管理多个 API 提供商配置，支持快速切换、高级定制和配置导出/导入。

### 1.2 核心特性
- ✅ 多配置管理（创建、编辑、删除、复制）
- ✅ 快速配置切换
- ✅ 高级配置选项（超时、重试、代理、SSL 等）
- ✅ 配置导出/导入
- ✅ 本地存储持久化
- ✅ 实时预览和统计

## 2. 系统架构

### 2.1 组件结构

```
MultiProviderManager (主管理器)
├── ConfigListContainer (配置列表)
│   ├── ConfigCard (配置卡片)
│   │   ├── ConfigHeader (卡片头部)
│   │   │   ├── ConfigInfo (配置信息)
│   │   │   └── ConfigActions (操作按钮)
│   │   └── ConfigDetails (展开详情)
│   └── EmptyState (空状态)
├── FormSection (新增/编辑表单)
│   ├── FormField (表单字段)
│   └── ButtonGroup (按钮组)
└── Statistics (统计信息)

AdvancedProviderConfig (高级配置)
├── BasicSettings (基础设置)
├── RateLimitSettings (速率限制)
├── CustomHeaders (自定义请求头)
├── ProxySettings (代理设置)
├── SSLSettings (SSL/TLS 设置)
└── LoggingSettings (日志设置)

MultiProviderSection (设置部分)
├── MultiProviderManager (管理器)
├── InfoBox (信息框)
└── ErrorMessage (错误消息)

MultiProviderIntegration (集成示例)
├── TabContainer (标签页)
├── BasicTab (基础配置标签)
├── AdvancedTab (高级设置标签)
└── ToolsTab (工具标签)
```

### 2.2 数据流

```
User Action
    ↓
Component Event Handler
    ↓
State Update (React)
    ↓
localStorage Update
    ↓
UI Re-render
    ↓
Visual Feedback
```

## 3. 数据模型

### 3.1 ApiProviderConfig 接口

```typescript
interface ApiProviderConfig {
  // 唯一标识
  id: string                          // 格式: config_${timestamp}_${random}
  
  // 基础信息
  name: string                        // 配置显示名称
  provider: string                    // 提供商类型
  description?: string                // 配置描述
  
  // API 配置
  baseUrl?: string                    // API 基础 URL
  apiKey: string                      // API 密钥（必填）
  modelId: string                     // 模型 ID（必填）
  
  // 状态
  isActive: boolean                   // 是否为活跃配置
  
  // 元数据
  createdAt: number                   // 创建时间戳
  updatedAt: number                   // 更新时间戳
  tags?: string[]                     // 标签分类
  
  // 高级配置
  customHeaders?: Record<string, string>  // 自定义请求头
  timeout?: number                    // 请求超时（毫秒）
  retryCount?: number                 // 重试次数
  rateLimit?: {                       // 速率限制
    requestsPerMinute?: number
    tokensPerMinute?: number
  }
}
```

### 3.2 AdvancedConfig 接口

```typescript
interface AdvancedConfig {
  // 基础设置
  timeout?: number                    // 请求超时
  retryCount?: number                 // 重试次数
  
  // 速率限制
  rateLimit?: {
    requestsPerMinute?: number
    tokensPerMinute?: number
  }
  
  // 自定义请求头
  customHeaders?: Record<string, string>
  
  // 代理设置
  proxy?: {
    enabled?: boolean
    url?: string
    auth?: {
      username?: string
      password?: string
    }
  }
  
  // SSL/TLS 设置
  ssl?: {
    verify?: boolean
    caPath?: string
  }
  
  // 日志设置
  logging?: {
    enabled?: boolean
    level?: "debug" | "info" | "warn" | "error"
  }
}
```

### 3.3 存储格式

#### localStorage 键：`shuncode_api_configs`
```json
[
  {
    "id": "config_1717500000000_abc123def",
    "name": "生产环境 OpenAI",
    "provider": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "modelId": "gpt-4-turbo",
    "isActive": true,
    "description": "用于生产环境的 OpenAI 配置",
    "createdAt": 1717500000000,
    "updatedAt": 1717500000000,
    "tags": ["production", "openai"],
    "timeout": 30000,
    "retryCount": 3,
    "rateLimit": {
      "requestsPerMinute": 60,
      "tokensPerMinute": 90000
    }
  }
]
```

#### localStorage 键：`shuncode_advanced_configs`
```json
{
  "config_1717500000000_abc123def": {
    "timeout": 30000,
    "retryCount": 3,
    "rateLimit": {
      "requestsPerMinute": 60,
      "tokensPerMinute": 90000
    },
    "customHeaders": {
      "X-Custom-Header": "value"
    },
    "proxy": {
      "enabled": false
    },
    "ssl": {
      "verify": true
    },
    "logging": {
      "enabled": false
    }
  }
}
```

## 4. 核心功能实现

### 4.1 配置管理

#### 创建配置
```typescript
const handleSaveConfig = () => {
  // 1. 验证必填字段
  if (!formData.name || !formData.apiKey || !formData.modelId) {
    alert("请填写必要字段")
    return
  }

  // 2. 生成新配置
  const newConfig: ApiProviderConfig = {
    id: generateId(),
    ...formData,
    isActive: configs.length === 0,  // 第一个配置默认激活
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  // 3. 更新状态和存储
  onConfigsChange([...configs, newConfig])
  resetForm()
}
```

#### 编辑配置
```typescript
const handleEditConfig = (id: string) => {
  const config = configs.find(c => c.id === id)
  if (config) {
    setFormData(config)
    setEditingId(id)
    setShowForm(true)
  }
}

const handleSaveConfig = () => {
  if (editingId) {
    const updatedConfigs = configs.map(config =>
      config.id === editingId
        ? { ...config, ...formData, updatedAt: Date.now() }
        : config
    )
    onConfigsChange(updatedConfigs)
  }
}
```

#### 删除配置
```typescript
const handleDeleteConfig = (id: string) => {
  const updatedConfigs = configs.filter(config => config.id !== id)
  onConfigsChange(updatedConfigs)

  // 如果删除的是活跃配置，激活第一个
  if (activeConfigId === id && updatedConfigs.length > 0) {
    onActiveConfigChange(updatedConfigs[0].id)
  }
}
```

#### 复制配置
```typescript
const handleDuplicateConfig = (id: string) => {
  const configToCopy = configs.find(config => config.id === id)
  if (!configToCopy) return

  const newConfig: ApiProviderConfig = {
    ...configToCopy,
    id: generateId(),
    name: `${configToCopy.name} (Copy)`,
    isActive: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  onConfigsChange([...configs, newConfig])
}
```

### 4.2 配置切换

```typescript
const handleActivateConfig = (id: string) => {
  const updatedConfigs = configs.map(config => ({
    ...config,
    isActive: config.id === id,
  }))
  onConfigsChange(updatedConfigs)
  onActiveConfigChange(id)
}
```

### 4.3 导出/导入

#### 导出
```typescript
const handleExportConfigs = () => {
  const exportData = {
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    configs,
    advancedConfigs,
  }

  const dataStr = JSON.stringify(exportData, null, 2)
  const dataBlob = new Blob([dataStr], { type: "application/json" })
  const url = URL.createObjectURL(dataBlob)
  const link = document.createElement("a")
  link.href = url
  link.download = `shuncode-api-configs-${Date.now()}.json`
  link.click()
  URL.revokeObjectURL(url)
}
```

#### 导入
```typescript
const handleImportConfigs = () => {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".json"
  input.onchange = (e) => {
    const file = e.target.files?.[0]
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result)
        if (data.configs && Array.isArray(data.configs)) {
          setConfigs(data.configs)
          localStorage.setItem("shuncode_api_configs", JSON.stringify(data.configs))
        }
      } catch (error) {
        alert("导入失败：文件格式不正确")
      }
    }
    reader.readAsText(file)
  }
  input.click()
}
```

## 5. UI/UX 设计

### 5.1 配置卡片设计

```
┌─ ● 配置名称 (生产环境 OpenAI)                    [✓活跃] [↓] [⎘] [✎] [🗑]
│  提供商 • https://api.openai.com/v1
├─────────────────────────────────────────────────────────────
│ 模型 ID: gpt-4-turbo
│ 基础 URL: https://api.openai.com/v1
│ API Key: sk-••••••••••••••••••••••••••••••
│ 描述: 用于生产环境的 OpenAI 配置
│ 超时时间: 30000ms
│ 重试次数: 3
│ 标签: [production] [openai]
│ 创建时间: 2026-06-05 12:00:00
└─────────────────────────────────────────────────────────────
```

### 5.2 表单设计

```
新增配置
┌─────────────────────────────────────────────────────────────
│ 配置名称 *
│ [输入框: 例如：生产环境 OpenAI]
│
│ 提供商
│ [下拉框: OpenAI Compatible ▼]
│
│ 基础 URL
│ [输入框: https://api.openai.com/v1]
│
│ API Key *
│ [密码框: ••••••••••••••••••••••••••••••]
│
│ 模型 ID *
│ [输入框: 例如：gpt-4-turbo]
│
│ 描述
│ [输入框: 可选：配置的描述信息]
│
│ 超时时间 (毫秒)
│ [输入框: 30000]
│
│ 重试次数
│ [输入框: 3]
│
│ [✓ 保存] [✕ 取消]
└─────────────────────────────────────────────────────────────
```

### 5.3 高级设置设计

```
基础设置 ▼
├─ 请求超时 (毫秒): [30000]
└─ 重试次数: [3]

速率限制 ▼
├─ 每分钟请求数: [60]
└─ 每分钟 Token 数: [90000]

自定义请求头 ▼
├─ [Header 名称] [Header 值] [🗑]
├─ [Header 名称] [Header 值] [🗑]
└─ [+ 添加请求头]

代理设置 ▼
├─ ☐ 启用代理
└─ (禁用时隐藏以下字段)

SSL/TLS 设置 ▼
├─ ☑ 验证 SSL 证书
└─ CA 证书路径: [/path/to/ca-cert.pem]

日志设置 ▼
├─ ☐ 启用日志
└─ (禁用时隐藏以下字段)
```

## 6. 状态管理

### 6.1 本地状态

```typescript
// MultiProviderManager 组件
const [expandedId, setExpandedId] = useState<string | null>(null)
const [showForm, setShowForm] = useState(false)
const [editingId, setEditingId] = useState<string | null>(null)
const [formData, setFormData] = useState<Partial<ApiProviderConfig>>({})

// MultiProviderIntegration 组件
const [activeTab, setActiveTab] = useState<"basic" | "advanced" | "tools">("basic")
const [configs, setConfigs] = useState<ApiProviderConfig[]>([])
const [activeConfigId, setActiveConfigId] = useState<string | null>(null)
const [advancedConfigs, setAdvancedConfigs] = useState<Record<string, AdvancedConfig>>({})
```

### 6.2 持久化存储

```typescript
// 保存到 localStorage
localStorage.setItem("shuncode_api_configs", JSON.stringify(configs))
localStorage.setItem("shuncode_advanced_configs", JSON.stringify(advancedConfigs))

// 从 localStorage 加载
const stored = localStorage.getItem("shuncode_api_configs")
const configs = stored ? JSON.parse(stored) : []
```

## 7. 集成指南

### 7.1 在设置面板中集成

```typescript
// 在 SettingsView.tsx 中添加新标签页
export const SETTINGS_TABS: SettingsTab[] = [
  // ... 其他标签页
  {
    id: "multi-provider",
    nameKey: "settings.tabs.multiProvider.name",
    tooltipKey: "settings.tabs.multiProvider.tooltip",
    headerKey: "settings.tabs.multiProvider.header",
    icon: Layers,
  },
]

// 在 TAB_CONTENT_MAP 中添加映射
const TAB_CONTENT_MAP = useMemo(
  () => ({
    // ... 其他映射
    "multi-provider": MultiProviderSection,
  }),
  [],
)
```

### 7.2 与 API 配置同步

```typescript
// 当活跃配置变更时，更新全局 API 配置
const handleActiveConfigChange = async (configId: string) => {
  const activeConfig = configs.find(c => c.id === configId)
  if (activeConfig) {
    // 更新全局 API 配置
    await updateApiConfiguration({
      openAiBaseUrl: activeConfig.baseUrl,
      openAiApiKey: activeConfig.apiKey,
      planModeOpenAiModelId: activeConfig.modelId,
      actModeOpenAiModelId: activeConfig.modelId,
    })
  }
}
```

## 8. 扩展性

### 8.1 添加新的提供商

```typescript
// 在 MultiProviderManager.tsx 中的提供商列表中添加
<option value="new-provider">New Provider</option>

// 在 AdvancedProviderConfig.tsx 中添加提供商特定的配置
if (config.provider === "new-provider") {
  // 添加特定配置字段
}
```

### 8.2 添加新的高级配置选项

```typescript
// 1. 更新 AdvancedConfig 接口
interface AdvancedConfig {
  // ... 现有字段
  newOption?: {
    field1?: string
    field2?: number
  }
}

// 2. 在 AdvancedProviderConfig.tsx 中添加 UI
<Section>
  <SectionHeader onClick={() => toggleSection("newOption")}>
    <span>新选项</span>
  </SectionHeader>
  {expandedSections.has("newOption") && (
    <SectionContent>
      {/* 新选项的表单字段 */}
    </SectionContent>
  )}
</Section>
```

## 9. 性能优化

### 9.1 渲染优化
- 使用 `useMemo` 缓存计算结果
- 使用 `useCallback` 缓存事件处理器
- 虚拟化长列表（如果配置数量很多）

### 9.2 存储优化
- 定期清理过期配置
- 压缩存储数据
- 实现配置版本管理

### 9.3 网络优化
- 批量更新配置
- 防抖/节流用户输入
- 异步加载配置

## 10. 安全考虑

### 10.1 API Key 安全
- 不在 localStorage 中明文存储 API Key
- 在 UI 中掩盖 API Key 显示
- 实现加密存储（可选）

### 10.2 配置安全
- 验证导入的配置文件
- 防止 XSS 攻击
- 实现访问控制（可选）

### 10.3 数据隐私
- 不收集用户配置数据
- 提供配置导出功能
- 支持配置删除

## 11. 测试策略

### 11.1 单元测试
- 配置 CRUD 操作
- 数据验证
- 状态管理

### 11.2 集成测试
- 组件集成
- localStorage 操作
- 导出/导入功能

### 11.3 E2E 测试
- 完整工作流
- 用户交互
- 错误处理

## 12. 部署和发布

### 12.1 版本管理
- 遵循语义化版本
- 维护更新日志
- 提供迁移指南

### 12.2 兼容性
- 向后兼容
- 数据迁移脚本
- 降级方案

## 13. 未来改进

### 13.1 短期
- [ ] 配置搜索和过滤
- [ ] 配置分组
- [ ] 快捷键支持
- [ ] 配置模板

### 13.2 中期
- [ ] 云端同步
- [ ] 团队共享
- [ ] 配置版本控制
- [ ] 审计日志

### 13.3 长期
- [ ] AI 辅助配置
- [ ] 自动优化建议
- [ ] 成本分析
- [ ] 性能监控

## 14. 参考资源

- [React Hooks 文档](https://react.dev/reference/react)
- [styled-components 文档](https://styled-components.com/)
- [localStorage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [VSCode WebView UI Toolkit](https://github.com/microsoft/vscode-webview-ui-toolkit)

---

**文档版本**: 1.0.0  
**最后更新**: 2026-06-05  
**作者**: Shuncode 开发团队
