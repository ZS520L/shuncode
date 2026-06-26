> **English version:** [network.md](../../development/network.md)

# Сетевые запросы и прокси

## Важно

**Не использовать** глобальный `fetch` и axios «из коробки» в коде расширения: в части окружений они не подхватывают настройки прокси.

## Правила

### Использование fetch

```typescript
// ❌ Неверно
const response = await fetch('https://api.example.com/data')

// ✅ Верно
import { fetch } from '@/shared/net'
const response = await fetch('https://api.example.com/data')
```

### Использование axios

```typescript
// ❌ Неверно
import axios from 'axios'
const response = await axios.get('https://api.example.com')

// ✅ Верно
import axios from 'axios'
import { getAxiosSettings } from '@/shared/net'
const response = await axios.get('https://api.example.com', {
  headers: { 'Authorization': '...' },
  ...getAxiosSettings()
})
```

### Сторонние клиенты (OpenAI, Anthropic и т.д.)

Большинство API-клиентов принимают свой экземпляр `fetch`:

```typescript
import OpenAI from "openai"
import { fetch } from "@/shared/net"

const client = new OpenAI({ apiKey: '...', fetch })
```

### В Webview

В `webview-ui/` глобальный `fetch` допустим — прокси обрабатывает браузер.

## Тестирование

Для моков используйте `mockFetchForTesting`:

```typescript
import { mockFetchForTesting } from "@/shared/net"

test('my test', async () => {
  const mockFetch = jest.fn().mockResolvedValue(new Response('{}'))
  await mockFetchForTesting(mockFetch, async () => {
    await myFunctionThatUsesFetch()
  })
})
```

## Чеклист для новых сетевых вызовов

1. Импортирован `@/shared/net`
2. Используется `fetch` из `@/shared/net` (не глобальный)
3. Для axios: используется `getAxiosSettings()`
4. Сторонние клиенты получают кастомный `fetch`
