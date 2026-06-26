> **Русская версия:** [network.md](../ru/development/network.md)

# Network Requests & Proxy

## Important

**Do NOT** use the global `fetch` or default `axios` in extension code. They don't pick up proxy settings in some environments.

## Rules

### Using fetch

```typescript
// ❌ Wrong
const response = await fetch('https://api.example.com/data')

// ✅ Correct
import { fetch } from '@/shared/net'
const response = await fetch('https://api.example.com/data')
```

### Using axios

```typescript
// ❌ Wrong
import axios from 'axios'
const response = await axios.get('https://api.example.com')

// ✅ Correct
import axios from 'axios'
import { getAxiosSettings } from '@/shared/net'
const response = await axios.get('https://api.example.com', {
  headers: { 'Authorization': '...' },
  ...getAxiosSettings()
})
```

### Third-party clients (OpenAI, Anthropic, etc.)

Most API clients accept a custom `fetch`:

```typescript
import OpenAI from "openai"
import { fetch } from "@/shared/net"

const client = new OpenAI({ apiKey: '...', fetch })
```

### In Webview

In `webview-ui/`, the global `fetch` is fine — the browser handles proxy natively.

## Testing

Use `mockFetchForTesting` for mocking:

```typescript
import { mockFetchForTesting } from "@/shared/net"

test('my test', async () => {
  const mockFetch = jest.fn().mockResolvedValue(new Response('{}'))
  await mockFetchForTesting(mockFetch, async () => {
    await myFunctionThatUsesFetch()
  })
})
```

## Checklist for New Network Calls

1. Imported `@/shared/net`
2. Using `fetch` from `@/shared/net` (not global)
3. For axios: using `getAxiosSettings()`
4. Third-party clients receive custom `fetch`
