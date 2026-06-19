# 多接口配置管理系统使用指南

## 概述

多接口配置管理系统允许用户在 ShunCode 中管理多个 API 提供商配置，支持快速切换不同的接口、密钥和模型设置。

## 主要功能

### 1. 配置管理
- **创建配置**：添加新的 API 提供商配置
- **编辑配置**：修改现有配置的参数
- **删除配置**：移除不需要的配置
- **复制配置**：快速复制现有配置并进行修改
- **激活配置**：选择当前使用的配置

### 2. 支持的提供商
- OpenAI Compatible（OpenAI 兼容接口）
- Anthropic（Claude）
- OpenRouter
- Groq
- DeepSeek
- Gemini
- Ollama
- LM Studio

### 3. 配置项

#### 基础信息
- **配置名称**：用于识别配置的显示名称
- **提供商**：API 提供商类型
- **基础 URL**：API 的基础 URL（可选）
- **API Key**：API 密钥（必填）
- **模型 ID**：使用的模型标识符（必填）
- **描述**：配置的描述信息（可选）

#### 高级设置
- **超时时间**：请求超时时间（毫秒）
- **重试次数**：请求失败时的重试次数
- **速率限制**：
  - 每分钟请求数
  - 每分钟 Token 数
- **自定义请求头**：添加自定义 HTTP 请求头
- **代理设置**：
  - 代理 URL
  - 代理认证（用户名/密码）
- **SSL/TLS 设置**：
  - 验证 SSL 证书
  - CA 证书路径
- **日志设置**：
  - 启用日志
  - 日志级别（Debug/Info/Warn/Error）

## 使用流程

### 创建新配置

1. 点击"新增配置"按钮
2. 填写必要信息：
   - 配置名称
   - API Key
   - 模型 ID
3. 可选：填写基础 URL 和其他信息
4. 点击"保存"

### 编辑配置

1. 在配置卡片上点击编辑按钮（✎）
2. 修改所需的字段
3. 点击"保存"

### 切换活跃配置

1. 点击配置卡片的左侧圆形指示器
2. 或点击配置卡片的任何地方
3. 当前活跃配置会显示绿色"活跃"标签

### 复制配置

1. 点击配置卡片上的复制按钮（⎘）
2. 新配置会自动创建为"原配置名 (Copy)"
3. 编辑新配置的名称和其他参数

### 删除配置

1. 点击配置卡片上的删除按钮（🗑）
2. 配置会立即被删除
3. 如果删除的是活跃配置，系统会自动激活第一个配置

## 数据存储

配置数据存储在浏览器的 localStorage 中，键名为 `shuncode_api_configs`。

### 存储格式

```json
[
  {
    "id": "config_1234567890_abc123def",
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

## 最佳实践

### 1. 命名约定
使用清晰的命名约定来区分不同的配置：
- `生产环境 OpenAI`
- `开发环境 Groq`
- `测试环境 DeepSeek`
- `备用 Claude`

### 2. 安全性
- 不要在配置名称或描述中暴露敏感信息
- API Key 在存储时会被掩盖显示
- 建议为不同环境使用不同的 API Key

### 3. 标签使用
使用标签对配置进行分类：
- `production` - 生产环境
- `development` - 开发环境
- `testing` - 测试环境
- `backup` - 备用配置
- `experimental` - 实验性配置

### 4. 超时设置
根据你的网络环境调整超时时间：
- 快速网络：15000-20000ms
- 普通网络：25000-30000ms
- 慢速网络：40000-60000ms

### 5. 重试策略
- 生产环境：3-5 次重试
- 开发环境：1-2 次重试
- 测试环境：0-1 次重试

## 集成示例

### 在组件中使用

```typescript
import MultiProviderManager, { ApiProviderConfig } from "@/components/settings/MultiProviderManager"

export function MyComponent() {
  const [configs, setConfigs] = useState<ApiProviderConfig[]>([])
  const [activeConfigId, setActiveConfigId] = useState<string>()

  return (
    <MultiProviderManager
      configs={configs}
      onConfigsChange={setConfigs}
      onActiveConfigChange={setActiveConfigId}
      activeConfigId={activeConfigId}
    />
  )
}
```

### 高级配置编辑

```typescript
import AdvancedProviderConfig, { AdvancedConfig } from "@/components/settings/AdvancedProviderConfig"

export function AdvancedSettings() {
  const [advConfig, setAdvConfig] = useState<AdvancedConfig>({})

  return (
    <AdvancedProviderConfig
      config={advConfig}
      onChange={setAdvConfig}
    />
  )
}
```

## 故障排除

### 配置无法保存
- 检查浏览器是否允许 localStorage
- 确保填写了所有必填字段（名称、API Key、模型 ID）
- 查看浏览器控制台是否有错误信息

### 配置丢失
- 检查浏览器的隐私设置
- 尝试清除浏览器缓存后重新添加配置
- 检查 localStorage 中的 `shuncode_api_configs` 键

### 切换配置不生效
- 确保配置已被激活（显示绿色"活跃"标签）
- 刷新页面后重试
- 检查浏览器控制台是否有错误

## API 参考

### MultiProviderManager Props

```typescript
interface MultiProviderManagerProps {
  configs: ApiProviderConfig[]
  onConfigsChange: (configs: ApiProviderConfig[]) => void
  onActiveConfigChange: (configId: string) => void
  activeConfigId?: string
}
```

### ApiProviderConfig 接口

```typescript
interface ApiProviderConfig {
  id: string // 唯一标识符
  name: string // 显示名称
  provider: string // 提供商类型
  baseUrl?: string // API 基础 URL
  apiKey: string // API 密钥
  modelId: string // 模型 ID
  isActive: boolean // 是否为活跃配置
  description?: string // 描述
  createdAt: number // 创建时间戳
  updatedAt: number // 更新时间戳
  tags?: string[] // 标签
  customHeaders?: Record<string, string> // 自定义请求头
  timeout?: number // 请求超时时间（毫秒）
  retryCount?: number // 重试次数
  rateLimit?: {
    requestsPerMinute?: number
    tokensPerMinute?: number
  }
}
```

## 常见问题

### Q: 可以有多个活跃配置吗？
A: 不可以。同一时间只能有一个活跃配置。激活新配置时，之前的活跃配置会自动变为非活跃。

### Q: 配置数据会同步到云端吗？
A: 目前配置数据仅存储在本地 localStorage 中。如需云端同步，请联系开发团队。

### Q: 如何导出/导入配置？
A: 你可以从浏览器开发者工具中复制 localStorage 中的 `shuncode_api_configs` 数据进行备份。

### Q: 删除配置后可以恢复吗？
A: 不可以。删除后配置会立即被移除。建议在删除前进行备份。

### Q: 支持哪些 API 提供商？
A: 目前支持 OpenAI Compatible、Anthropic、OpenRouter、Groq、DeepSeek、Gemini、Ollama 和 LM Studio。更多提供商支持正在开发中。

## 更新日志

### v1.0.0 (2026-06-05)
- 初始版本发布
- 支持基础配置管理
- 支持高级配置选项
- 支持配置的创建、编辑、删除、复制
- 支持配置激活和切换

## 反馈和建议

如有任何问题或建议，请通过以下方式联系我们：
- 提交 GitHub Issue
- 发送邮件至 support@shuncode.dev
- 在讨论区留言
