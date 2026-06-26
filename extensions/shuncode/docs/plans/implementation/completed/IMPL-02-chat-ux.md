# IMPL-02: Chat UX — scroll-to-top + Thinking block fix

> Приоритет: ВЫСОКИЙ
> Оценка: 3-5 часов
> Зависимости: нет

---

## Цель

Две проблемы с UX чата:
1. Когда пользователь отправляет новое сообщение, предыдущий ответ ИИ занимает весь экран. Нужно скроллить чат так, чтобы новое сообщение пользователя было наверху.
2. Когда ProcessBlock ("Thinking/Exploring") раскрывается в нижней части чата, содержимое обрезается — чат не скроллится вверх чтобы показать контент блока.

## Результат

- При отправке нового сообщения: чат скроллится так, чтобы сообщение пользователя было наверху экрана
- Во время работы ИИ: обычный плавный автоскролл за ответом (как сейчас)
- При раскрытии ProcessBlock: чат автоматически скроллится чтобы содержимое блока было видно

---

## Часть A: Scroll-to-top при новом сообщении

### Файлы:
- `webview-ui/src/components/chat/chat-view/hooks/useScrollBehavior.ts` — основная логика скролла

### Шаг A1: Добавить отслеживание нового сообщения пользователя

В файле `useScrollBehavior.ts` нужно отследить момент когда количество `user_feedback` сообщений увеличивается — значит пользователь отправил новое сообщение.

**Найти** (в начале хука, после объявления state):

```typescript
const [scrolledPastUserMessage, setScrolledPastUserMessage] = useState<ShuncodeMessage | null>(null)
```

**Добавить ПОСЛЕ этой строки:**

```typescript
// Track previous user message count to detect new user messages
const prevUserMsgCountRef = useRef(0)
```

### Шаг A2: Добавить эффект scroll-to-top

**Найти** блок (ближе к концу файла, перед `return`):

```typescript
useEffect(() => {
	if (!messages?.length) {
		setShowScrollToBottom(false)
	}
}, [messages.length])
```

**Добавить ПОСЛЕ этого блока:**

```typescript
// Scroll to show user's new message at top when they send a new task
useEffect(() => {
	const currentCount = userFeedbackMessages.length
	const prevCount = prevUserMsgCountRef.current
	prevUserMsgCountRef.current = currentCount

	// User sent a new message (count increased)
	if (currentCount > prevCount && currentCount > 0) {
		const lastUserMsg = userFeedbackMessages[currentCount - 1]
		if (!lastUserMsg) return

		// Find the index of this message in groupedMessages
		let groupIndex = -1
		for (let i = 0; i < groupedMessages.length; i++) {
			const group = groupedMessages[i]
			if (Array.isArray(group)) {
				if (group.some((msg) => msg.ts === lastUserMsg.ts)) {
					groupIndex = i
					break
				}
			} else if (group.ts === lastUserMsg.ts) {
				groupIndex = i
				break
			}
		}

		if (groupIndex !== -1) {
			// Re-enable auto-scroll for AI response that will follow
			disableAutoScrollRef.current = false

			// Small delay to let Virtuoso render the new message
			requestAnimationFrame(() => {
				virtuosoRef.current?.scrollToIndex({
					index: groupIndex,
					align: "start",
					behavior: "auto",
				})
			})
		}
	}
}, [userFeedbackMessages.length, groupedMessages])
```

**Логика:**
- Когда количество `user_feedback` сообщений растёт — пользователь отправил новое сообщение
- Скроллим к этому сообщению с `align: "start"` (оно будет вверху)
- `disableAutoScrollRef.current = false` — чтобы автоскролл за ответом ИИ продолжил работать
- `behavior: "auto"` — мгновенный скролл (не smooth), т.к. пользователь хочет сразу видеть своё сообщение

---

## Часть B: Thinking-блок не помещается при раскрытии

### Файлы:
- `webview-ui/src/components/chat/chat-view/components/messages/ProcessBlock.tsx`

### Шаг B1: Добавить callback для уведомления о раскрытии

**Найти** интерфейс пропсов:

```typescript
interface ProcessBlockProps {
	messages: ShuncodeMessage[]
	allMessages: ShuncodeMessage[]
	isLast?: boolean
}
```

**Заменить на:**

```typescript
interface ProcessBlockProps {
	messages: ShuncodeMessage[]
	allMessages: ShuncodeMessage[]
	isLast?: boolean
	onExpandChange?: (expanded: boolean) => void
}
```

### Шаг B2: Добавить scrollIntoView при раскрытии

**Найти:**

```typescript
export const ProcessBlock = memo(({ messages, allMessages, isLast }: ProcessBlockProps) => {
	const scrollRef = useRef<HTMLDivElement>(null)
	const [isExpanded, setIsExpanded] = useState(false)
```

**Заменить на:**

```typescript
export const ProcessBlock = memo(({ messages, allMessages, isLast, onExpandChange }: ProcessBlockProps) => {
	const scrollRef = useRef<HTMLDivElement>(null)
	const blockRef = useRef<HTMLDivElement>(null)
	const [isExpanded, setIsExpanded] = useState(false)
```

### Шаг B3: Обновить handleToggle

**Найти:**

```typescript
const handleToggle = useCallback(() => {
	setIsExpanded((prev) => !prev)
}, [])
```

**Заменить на:**

```typescript
const handleToggle = useCallback(() => {
	setIsExpanded((prev) => {
		const next = !prev
		if (next) {
			// When expanding, scroll the block into view after DOM update
			requestAnimationFrame(() => {
				blockRef.current?.scrollIntoView({
					behavior: "smooth",
					block: "nearest",
				})
			})
		}
		onExpandChange?.(next)
		return next
	})
}, [onExpandChange])
```

### Шаг B4: Добавить ref на корневой элемент

**Найти:**

```typescript
return (
	<div className="px-4 py-1">
```

**Заменить на:**

```typescript
return (
	<div className="px-4 py-1" ref={blockRef}>
```

**Логика:**
- При раскрытии (`next = true`) ждём один кадр (`requestAnimationFrame`) пока DOM обновится
- `scrollIntoView({ block: "nearest" })` — скроллит минимально необходимое расстояние чтобы блок стал видимым
- Если блок уже полностью видим — ничего не происходит
- Если блок частично скрыт внизу — чат прокрутится вверх ровно настолько чтобы показать его

---

## Проверка

### Часть A (scroll-to-top):
1. Открыть чат, отправить задачу, дождаться длинного ответа ИИ
2. Отправить новую задачу
3. **Ожидание:** сообщение пользователя должно оказаться вверху экрана, предыдущий ответ ИИ уехал вверх
4. Во время ответа ИИ на новую задачу — чат должен плавно скроллиться за ответом

### Часть B (ProcessBlock):
1. Открыть чат, дождаться ответа ИИ с ProcessBlock (серый сворачиваемый блок)
2. Промотать чат вниз так чтобы ProcessBlock был в самом низу видимой области
3. Кликнуть на ProcessBlock чтобы раскрыть
4. **Ожидание:** чат автоматически скроллится чтобы содержимое блока было видно
5. Проверить что повторный клик (свернуть) не вызывает нежелательный скролл

### Edge cases:
- Отправить сообщение когда чат пустой — не должно быть ошибок
- Раскрыть ProcessBlock который уже полностью видим — не должен скроллиться
- Проверить что автоскролл во время работы ИИ не сломался
