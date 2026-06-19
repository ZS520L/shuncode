# План: Редизайн SettingsView (Концепция Kilocode)

> Перетягиваем визуальную концепцию, код пишем свой.
> Создано: 2026-02-13

---

## 1. Аудит текущего состояния

### 1.1 Табы и их содержимое СЕЙЧАС

#### Таб "API Конфигурация" (`ApiConfigurationSection`)
- Профили Plan/Act (переключатель + раздельные модели)
- ApiOptions (провайдер, модель, ключи)
- Чекбокс "Разные модели для Plan/Act"
- **Вердикт:** Оставляем как есть. Переименовать таб → "Провайдеры".

#### Таб "Функции" (`FeatureSettingsSection`) — **ГЛАВНАЯ ПРОБЛЕМА**
15 настроек в одной куче, без группировки:

| # | Настройка | Тип | Куда переносим |
|---|-----------|-----|---------------|
| 1 | Субагенты + CLI install | блок | → Эксперименты |
| 2 | Checkpoints | checkbox | → Контекст |
| 3 | MCP Display Mode | dropdown | → Общие (UI) |
| 4 | Reasoning Effort | dropdown | → Общие (модель) |
| 5 | Строгий режим планирования | checkbox | → Контекст |
| 6 | Цепочка фокусировки + интервал | checkbox+input | → Контекст |
| 7 | Диктовка | checkbox | → Эксперименты |
| 8 | Авто-сжатие | checkbox | → Контекст |
| 9 | Веб-инструменты Shuncode | checkbox | → Эксперименты |
| 10 | Worktrees | checkbox | → Эксперименты |
| 11 | Нативный вызов инструментов | checkbox | → Эксперименты |
| 12 | Параллельный вызов инструментов | checkbox | → Эксперименты |
| 13 | Фоновое редактирование | checkbox | → Редактирование |
| 14 | Блок "Настройки редактирования" (3 чекбокса) | group | → Редактирование |
| 15 | Мульти-корень | checkbox | → Эксперименты |
| 16 | Навыки (skills) | checkbox | → Эксперименты |
| 17 | YOLO mode | checkbox | → Автоподтверждение |

**После разбивки таб "Функции" удаляется.**

#### Таб "Браузер" (`BrowserSettingsSection`)
- Отключить браузер (master toggle)
- Viewport size
- Remote browser connection + host + status
- Chrome executable path
- Custom browser args
- **Вердикт:** Без изменений. Хорошо структурирован.

#### Таб "Терминал" (`TerminalSettingsSection`)
- Профиль терминала по умолчанию
- Shell integration timeout
- Агрессивное переиспользование терминала
- Режим выполнения (VSCode / фоновый)
- Output line limit slider
- Ссылки на troubleshooting
- **Вердикт:** Без изменений. Хорошо структурирован.

#### Таб "Индексация" (`IndexingSettingsSection`)
- Режим (off/local/remote)
- Remote API settings (url, key, model)
- Статус + прогресс (2 прогресс-бара)
- Кнопки управления
- Advanced (max file size, ignored patterns)
- **Вердикт:** Без изменений. Хорошо структурирован.

#### Таб "Общие" (`GeneralSettingsSection`)
- Язык интерфейса
- Телеметрия
- **Вердикт:** Расширить. Перенести сюда MCP display mode и reasoning effort.

#### Таб "О программе" (`AboutSection`)
- Версия
- Описание
- TODO: ссылки
- **Вердикт:** Без изменений.

#### Таб "Отладка" (`DebugSection`)
- Syntax validation кнопка
- Diff system controls
- Reset state (workspace / global)
- Reset onboarding
- **Вердикт:** Скрыть в проде (`hidden: !IS_DEV`). Без изменений.

---

## 2. Целевая структура

### 2.1 Новые табы

| # | ID | Название | Иконка | Источник |
|---|-----|---------|--------|----------|
| 1 | `providers` | Провайдеры | `Plug` | Переименован из "API Конфигурация" |
| 2 | `auto-approve` | Автоподтверждение | `CheckCheck` | **НОВЫЙ** |
| 3 | `editing` | Редактирование | `Pencil` | **НОВЫЙ** |
| 4 | `context` | Контекст | `BrainCircuit` | **НОВЫЙ** |
| 5 | `browser` | Браузер | `SquareMousePointer` | Как есть |
| 6 | `terminal` | Терминал | `SquareTerminal` | Как есть |
| 7 | `indexing` | Индексация | `DatabaseZap` | Как есть |
| 8 | `experiments` | Эксперименты | `FlaskConical` | **НОВЫЙ** |
| 9 | `general` | Общие | `Wrench` | Расширен |
| 10 | `about` | О программе | `Info` | Как есть |
| 11 | `debug` | Отладка | `Bug` | hidden: !IS_DEV |

### 2.2 Детальное содержимое новых табов

#### Таб "Автоподтверждение" (`AutoApproveSection`)
```
┌─────────────────────────────────────────────┐
│ ⚠️ YOLO Mode                                │
│ ☐ Включить режим YOLO                       │
│   Описание: отключает все проверки           │
│                                              │
│ (будущее: allowedCommands, deniedCommands,   │
│  allowedMaxRequests, allowedMaxCost)         │
└─────────────────────────────────────────────┘
```
Сейчас минимальный таб (только YOLO), но с правильным будущим местом для расширения.

#### Таб "Редактирование" (`EditingSection`)
```
┌─────────────────────────────────────────────┐
│ Инструменты редактирования                   │
│ ☐ Упрощённые инструменты                     │
│ ☐ Проверять синтаксис перед применением       │
│ ☐ Блокировать при синтаксических ошибках      │
│                                              │
│ ☐ Фоновое редактирование (эксп.)             │
└─────────────────────────────────────────────┘
```

#### Таб "Контекст" (`ContextSection`)
```
┌─────────────────────────────────────────────┐
│ Управление контекстом                        │
│ ☐ Авто-сжатие                                │
│ ☐ Checkpoints                                │
│                                              │
│ Режим работы                                 │
│ ☐ Строгий режим планирования                 │
│                                              │
│ Цепочка фокусировки                          │
│ ☐ Включить цепочку фокусировки               │
│   Интервал напоминания: [6]                  │
└─────────────────────────────────────────────┘
```

#### Таб "Эксперименты" (`ExperimentsSection`)
```
┌─────────────────────────────────────────────┐
│ ⚗️ Экспериментальные функции                 │
│                                              │
│ Агенты                                       │
│ ☐ Субагенты (+ CLI install блок)             │
│ ☐ Навыки (skills)                            │
│                                              │
│ Вызов инструментов                           │
│ ☐ Нативный вызов инструментов                │
│ ☐ Параллельный вызов инструментов            │
│                                              │
│ Прочее                                       │
│ ☐ Worktrees                                  │
│ ☐ Веб-инструменты Shuncode                       │
│ ☐ Мульти-корневое рабочее пространство       │
│ ☐ Диктовка                                   │
└─────────────────────────────────────────────┘
```

#### Таб "Общие" (расширенный)
```
┌─────────────────────────────────────────────┐
│ Язык                                         │
│ [Выбор языка интерфейса]                     │
│                                              │
│ Модель                                       │
│ Уровень рассуждений OpenAI: [dropdown]       │
│                                              │
│ Отображение                                  │
│ Режим отображения MCP: [dropdown]            │
│                                              │
│ Телеметрия                                   │
│ ☐ Отправка отчётов                           │
└─────────────────────────────────────────────┘
```

---

## 3. Визуальные улучшения

### 3.1 Compact Mode (ResizeObserver)

**Как у Kilocode:**
- `data-compact` атрибут на контейнер.
- При ширине < 500px — только иконки.
- При ширине >= 500px — иконка + текст.

**Реализация:**
```tsx
const [isCompact, setIsCompact] = useState(false)
const containerRef = useRef<HTMLDivElement>(null)

useLayoutEffect(() => {
  const el = containerRef.current
  if (!el) return
  const ro = new ResizeObserver(([entry]) => {
    setIsCompact(entry.contentRect.width < 500)
  })
  ro.observe(el)
  return () => ro.disconnect()
}, [])
```

**Изменения в TabTrigger:**
- `data-compact={isCompact}` передаётся вниз.
- CSS: `data-[compact=true]:w-12 data-[compact=true]:justify-center`
- Текст: `{!isCompact && <span>{tab.name}</span>}`
- Тултип всегда показывается при compact.

### 3.2 Active Tab Styling (улучшение)

Сейчас:
```
opacity-100 border-l-2 border-l-foreground bg-selection
```

Целевое (как у Kilocode):
```
opacity-100 border-l-2 border-vscode-focusBorder bg-list-activeSelectionBackground
hover:bg-list-activeSelectionBackground cursor-default
```

Неактивные:
```
opacity-70 hover:bg-list-hoverBackground cursor-pointer
```

### 3.3 Section Cards (группировки внутри табов)

Оборачиваем логические группы в карточки:
```tsx
<div className="p-3 rounded-md border border-panel-border mb-4">
  <h4 className="text-sm font-semibold mb-3">{title}</h4>
  {children}
</div>
```

Уже частично есть в `FeatureSettingsSection` (блок "Настройки редактирования"), нужно применить системно.

### 3.4 Unsaved Changes Dialog

**Kilocode имеет:** полную систему `cachedState` + `isChangeDetected` + `AlertDialog`.

**Наша ситуация:** большинство настроек применяются мгновенно через `updateSetting()` → `StateServiceClient.updateSettings()`. Нет "save" кнопки.

**Решение:**
- **НЕ делаем** полный cachedState как у Kilocode (у них 1200+ строк handleSubmit).
- **Делаем** лёгкий вариант: при навигации от настроек (кнопка "Готово") — просто закрываем.
- Instant-apply сохраняем — это удобнее.
- **Опционально (фаза 2):** для текстовых полей (API keys, URLs) — debounced commit + индикатор "сохранено".

### 3.5 Scroll Position Preservation

Kilocode сохраняет позицию скролла для каждого таба:
```tsx
const scrollPositions = useRef<Record<SectionName, number>>({...})

// При переключении табов:
// 1. Сохранить текущую позицию
// 2. Восстановить позицию нового таба
```

Берём эту идею — дёшево и полезно.

---

## 4. Что НЕ берём из Kilocode

| Фича Kilocode | Почему НЕ берём |
|---------------|----------------|
| `cachedState` + handleSubmit (1200 строк) | У нас instant-apply, не нужен Save/Discard |
| Ghost Service | Специфика Kilocode |
| Profile types (chat/autocomplete) | У нас один тип |
| `fastApplyModel` / `fastApplyApiProvider` | Нет apply model |
| Auto-purge задач | Не приоритет |
| Image generation settings | Не приоритет |
| Custom modes view (полный) | Можно позже как отдельную фичу |
| Slash commands settings | У нас нет slash commands |
| Notification settings (sound, TTS) | Не приоритет |
| Display settings (timestamps, cost) | Можно позже |

---

## 5. Новые файлы

```
sections/
├── ApiConfigurationSection.tsx  (переименовать → ProvidersSection.tsx)
├── AutoApproveSection.tsx       ← НОВЫЙ
├── EditingSection.tsx           ← НОВЫЙ
├── ContextSection.tsx           ← НОВЫЙ
├── BrowserSettingsSection.tsx   (без изменений)
├── TerminalSettingsSection.tsx  (без изменений)
├── IndexingSettingsSection.tsx  (без изменений)
├── ExperimentsSection.tsx       ← НОВЫЙ
├── GeneralSettingsSection.tsx   (расширить)
├── AboutSection.tsx             (без изменений)
└── DebugSection.tsx             (hidden: !IS_DEV)

FeatureSettingsSection.tsx       ← УДАЛИТЬ после миграции
```

---

## 6. Оценка работ

| Этап | Часы | Описание |
|------|------|----------|
| 1. Layout + Compact Mode | 2-3 | ResizeObserver, data-compact, TabTrigger |
| 2. Active Tab Styling | 1 | focusBorder, activeSelectionBackground |
| 3. Scroll Position | 0.5 | useRef + onScroll + restore |
| 4. Разбивка Features → 4 секции | 3-4 | AutoApprove, Editing, Context, Experiments |
| 5. Расширить General | 1 | MCP display + reasoning effort |
| 6. Section Cards | 1-2 | Карточки внутри табов |
| 7. Переименование API Config → Providers | 0.5 | Tab name + header |
| 8. Debug hidden: !IS_DEV | 0.5 | Вернуть скрытие |
| 9. Тестирование | 2-3 | Все табы, compact, настройки |
| **Итого** | **~12-16ч** | |

---

## 7. Порядок реализации

### Фаза 1: Структура (4-6ч)
1. Создать 4 новых секции (пустые компоненты).
2. Перенести настройки из `FeatureSettingsSection` в новые секции.
3. Обновить `SETTINGS_TABS` и `TAB_CONTENT_MAP` в `SettingsView.tsx`.
4. Удалить `FeatureSettingsSection`.
5. Расширить `GeneralSettingsSection`.

### Фаза 2: Визуал (4-6ч)
1. Compact Mode (ResizeObserver).
2. Active Tab Styling.
3. Section Cards.
4. Scroll Position Preservation.

### Фаза 3: Полировка (2-4ч)
1. Проверить все табы — настройки сохраняются/читаются.
2. Тест compact mode на разных размерах.
3. Debug tab → hidden: !IS_DEV.
4. Переименование таба "API Конфигурация" → "Провайдеры".
