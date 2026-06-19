# IMPL-04: Settings UI Redesign

> Приоритет: ВЫСОКИЙ
> Статус: ✅ ВЫПОЛНЕНО
> Выполнено: 2026-02-14

---

## Что сделано

### Структура табов (было 8, стало 9+debug)

| # | ID | Название | Иконка | Источник |
|---|-----|---------|--------|----------|
| 1 | `providers` | Провайдеры | `SlidersHorizontal` | Переименован из "API Config" |
| 2 | `permissions` | Разрешения | `ShieldCheck` | **НОВЫЙ** — auto-approve + YOLO |
| 3 | `editing` | Редактирование | `Pencil` | **НОВЫЙ** — edit tools + bg edit + checkpoints |
| 4 | `context` | Контекст | `BrainCircuit` | **НОВЫЙ** — condense + plan + focus + reasoning |
| 5 | `browser` | Браузер | `SquareMousePointer` | Без изменений |
| 6 | `terminal` | Терминал | `SquareTerminal` | Без изменений |
| 7 | `indexing` | Индексация | `DatabaseZap` | Без изменений |
| 8 | `experiments` | Эксперименты | `FlaskConical` | **НОВЫЙ** — субагенты, skills, tools, etc. |
| 9 | `general` | Общие | `Wrench` | Расширен (+ MCP display + About) |
| 10 | `debug` | Отладка | `FlaskConical` | Только в режиме debug |

### Новые файлы

- `sections/PermissionsSection.tsx` — YOLO mode + 8 auto-approve чекбоксов + notifications
- `sections/EditingSection.tsx` — checkpoints + background edit + edit tools group
- `sections/ContextSection.tsx` — auto-condense + strict plan + reasoning effort + focus chain
- `sections/ExperimentsSection.tsx` — субагенты, skills, native/parallel tools, worktrees, etc.

### Изменённые файлы

- `SettingsView.tsx` — полностью переписан: новые табы, compact mode (ResizeObserver), scroll position preservation, маппинг старых ID
- `GeneralSettingsSection.tsx` — расширен: добавлен MCP display mode и блок About
- `Tab.tsx` — `Tab` и `TabContent` теперь поддерживают forwardRef
- `ApiConfigurationSection.tsx` — обновлён headerKey → "providers"
- `ChatView.tsx` — убран AutoApproveBar из footer
- `WhatsNewModal.tsx`, `WelcomeSection.tsx`, `ConfigureServersView.tsx`, `TaskHeader.tsx` — обновлены ссылки navigateToSettings()

### Удалённые файлы

- `sections/FeatureSettingsSection.tsx` — разбит на 4 новых секции
- `sections/AboutSection.tsx` — влит в GeneralSettingsSection

### i18n

Добавлены ключи в en.json и ru.json:
- Табы: providers, permissions, editing, context, experiments (name/tooltip/header)
- Permissions: description, все action labels/shortNames, section titles

### Визуальные улучшения

- **Compact mode** — при ширине < 500px только иконки
- **Scroll position preservation** — позиция скролла сохраняется при переключении табов
- **Active tab styling** — `border-l-focus-border` + `bg-list-activeSelection`
- **Section cards** — группировки настроек в карточках с рамкой
- **Debug tab** — видим только в режиме `debug`

### Обратная совместимость

- `navigateToSettings("api-config")` → маппится на `"providers"`
- `navigateToSettings("features")` → маппится на `"permissions"`
- `navigateToSettings("about")` → маппится на `"general"`
