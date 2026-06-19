# Сетевые запросы и прокси

Руководство по выполнению HTTP запросов в Shuncode AI.

## Важно

**НЕ используйте** глобальный `fetch` или дефолтный `axios` в коде расширения!

Глобальные функции не подхватывают настройки прокси в некоторых окружениях (JetBrains, CLI).

## Правила

### 1. Использование fetch

```typescript
// ❌ НЕПРАВИЛЬНО
const response = await fetch('https://api.example.com/data')

// ✅ ПРАВИЛЬНО
import { fetch } from '@/shared/net'

const response = await fetch('https://api.example.com/data')
```

### 2. Использование axios

```typescript
// ❌ НЕПРАВИЛЬНО
import axios from 'axios'
const response = await axios.get('https://api.example.com')

// ✅ ПРАВИЛЬНО
import axios from 'axios'
import { getAxiosSettings } from '@/shared/net'

const response = await axios.get('https://api.example.com', {
  headers: { 'Authorization': '...' },
  ...getAxiosSettings()  // КРИТИЧЕСКИ ВАЖНО
})
```

### 3. Сторонние клиенты (OpenAI, Anthropic и др.)

Большинство API клиентов позволяют передать кастомный `fetch`:

```typescript
// OpenAI
import OpenAI from "openai"
import { fetch } from "@/shared/net"

const client = new OpenAI({
  apiKey: '...',
  fetch  // Передаём наш fetch
})
```

```typescript
// Anthropic
import Anthropic from "@anthropic-ai/sdk"
import { fetch } from "@/shared/net"

const client = new Anthropic({
  apiKey: '...',
  fetch
})
```

### 4. В Webview

В webview можно использовать глобальный `fetch` — браузер сам обрабатывает прокси:

```typescript
// В webview-ui/ — это нормально
const response = await fetch('/api/data')
```

## Тестирование

Используйте `mockFetchForTesting` для мокирования:

```typescript
import { mockFetchForTesting } from "@/shared/net"

test('my test', async () => {
  const mockFetch = jest.fn().mockResolvedValue(new Response('{}'))

  await mockFetchForTesting(mockFetch, async () => {
    // Здесь fetch будет использовать mockFetch
    await myFunctionThatUsesFetch()
  })
  // После выхода — оригинальный fetch восстановлен
})
```

## Проверка при добавлении нового сетевого вызова

1. ✅ Импортирован `@/shared/net`
2. ✅ Используется `fetch` из `@/shared/net` (не глобальный)
3. ✅ Для axios используется `getAxiosSettings()`
4. ✅ Сторонние клиенты получают кастомный fetch

## См. также

- `src/shared/net.ts` — реализация обёрток
- [GENERAL.md](./GENERAL.md) — общие правила разработки
