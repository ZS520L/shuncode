# IMPL-08: Changelog + Rules (контекст между сессиями)

> Приоритет: ВЫСОКИЙ
> Оценка: 4-6 часов
> Зависимости: нет
> **Статус: ВЫПОЛНЕНО**

---

## Цель

Между сессиями ИИ теряет всё — что делали, какие решения приняли. Добавить два механизма:
1. **Файл правил проекта** — пишет ЧЕЛОВЕК, подгружается в промпт
2. **Автоматический changelog** — пишет СИСТЕМА (не ИИ), логирует факты из предыдущей сессии

## Результат

### Часть A: Файл правил проекта — УЖЕ РЕАЛИЗОВАНО

Система `.shuncoderules` уже присутствует в проекте и полностью покрывает эту задачу:

- **Глобальные правила**: директория `~/.shuncode/rules/` (подгружаются через `getGlobalShuncodeRules`)
- **Локальные правила**: файл или директория `.shuncoderules` в корне workspace (через `getLocalShuncodeRules`)
- Поддержка YAML frontmatter с условиями (conditional rules)
- Поддержка remote config rules
- Toggle-механизм для включения/выключения отдельных правил

Файлы: `src/core/context/instructions/user-instructions/shuncode-rules.ts`

### Часть B: Автоматический changelog — РЕАЛИЗОВАНО

1. **`src/core/context/SessionChangelog.ts`** — функция `extractChangelog()`
   - Парсит `ShuncodeMessage[]` из предыдущей задачи
   - Извлекает действия: edited, created, deleted, searched, ran (команды)
   - Дедуплицирует последовательные одинаковые действия
   - Лимит: 15 последних действий
   - Формат: `HH:MM action: target`

2. **`src/core/task/index.ts`** — подключение в `getEnvironmentDetails()`
   - Загружает `taskHistory` через `stateManager`
   - Находит предыдущую задачу (не текущую)
   - Вызывает `getSavedShuncodeMessages()` → `extractChangelog()`
   - Добавляет секцию `# Previous Session Actions` в environment_details
   - Только при первом сообщении (когда `includeFileDetails === true`)
   - Ошибки загрузки тихо игнорируются

---

## Затронутые файлы

| Файл | Действие |
|---|---|
| `src/core/context/SessionChangelog.ts` | Создан |
| `src/core/task/index.ts` | Добавлен import и вызов в `getEnvironmentDetails()` |

---

## Проверка

### Часть A (Project Rules):
Уже работает через `.shuncoderules`. Пользователь создаёт `.shuncoderules` в корне проекта — правила загружаются в промпт.

### Часть B (Changelog):
1. В первой сессии: отредактировать файлы, выполнить команды
2. Начать новый чат (новая задача)
3. В environment_details появится секция "Previous Session Actions"
4. ИИ видит что делалось ранее и может продолжить работу
