# Сетевые правила для агента

> Подробное руководство: [../development/NETWORK.md](../development/NETWORK.md)

**Краткие правила:**

1. **НЕ** используй глобальный `fetch` или дефолтный `axios` в коде расширения
2. Импортируй `fetch` из `@/shared/net`
3. Для `axios` — всегда добавляй `...getAxiosSettings()`
4. Сторонним клиентам (OpenAI, Anthropic) — передавай кастомный `fetch`
5. В webview — глобальный `fetch` допустим
