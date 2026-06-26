# IMPL-07: Debug Mode + Ask Mode

> Приоритет: ВАЖНЫЙ (P2-1, P2-2 из ROADMAP)
> Оценка: 8-12 часов
> Зависимости: IMPL-03 (системный промпт). Для UI использовать `useI18n()` (IMPL-11 ✅ выполнена)
> Статус: ✅ ВЫПОЛНЕНО

---

## Цель

Добавить два новых режима работы ИИ:
- **Ask Mode** — read-only, ИИ только отвечает на вопросы и читает код, не модифицирует
- **Debug Mode** — систематическая отладка: сбор evidence, гипотезы, проверка

## Результат

- ✅ Переключатель режимов в UI (Plan / Act / Ask / Debug) — 4-сегментный control
- ✅ В Ask Mode: инструменты записи файлов и терминала заблокированы
- ✅ В Debug Mode: специальный промпт для систематической отладки

---

## Выполненные изменения

### Шаг 1: Расширен тип Mode ✅

**Файл:** `src/shared/storage/types.ts`

```typescript
export type Mode = "plan" | "act" | "ask" | "debug"

export function getApiSettingsMode(mode: Mode): "plan" | "act" {
    return mode === "plan" || mode === "ask" ? "plan" : "act"
}

export function isReadOnlyMode(mode: Mode): boolean {
    return mode === "plan" || mode === "ask"
}
```

Добавлены хелперы `getApiSettingsMode` и `isReadOnlyMode` для маппинга режимов на API-настройки.

### Шаг 2-3: Промпты Ask + Debug ✅

**Файл:** `src/core/prompts/system-prompt/components/act_vs_plan_mode.ts`

- Обновлена секция ACT MODE V.S. PLAN MODE — теперь описывает все 4 режима
- Ask Mode: read-only, только чтение файлов, поиск и ответы на вопросы
- Debug Mode: систематическая отладка (evidence → hypothesis → test → fix → verify)

### Шаг 4: Tool filtering для Ask mode ✅

**Файл:** `src/core/task/ToolExecutor.ts`

- Добавлен список `ASK_MODE_RESTRICTED_TOOLS` — все write/execute/browser инструменты заблокированы
- При попытке использовать заблокированный инструмент в Ask mode возвращается сообщение об ошибке

### Шаг 5: UI — 4-сегментный переключатель ✅

**Изменённые файлы:**

1. **Proto:** `proto/shuncode/state.proto` + `src/shared/proto/shuncode/state.ts`
   - `PlanActMode` enum расширен: `PLAN=0, ACT=1, ASK=2, DEBUG=3`

2. **Backend конвертеры** (все обновлены для 4 режимов):
   - `src/core/controller/state/togglePlanActModeProto.ts`
   - `src/core/controller/state/updateSettings.ts`
   - `src/core/controller/state/updateSettingsCli.ts`
   - `src/core/controller/state/updateTaskSettings.ts`
   - `src/core/controller/task/newTask.ts`

3. **Controller:** `src/core/controller/index.ts`
   - `togglePlanActMode` — и Act, и Debug считаются "write" режимами для авто-апрува плана

4. **API handler:** `src/core/api/index.ts`
   - `buildApiHandler` использует `getApiSettingsMode()` для маппинга ask→plan, debug→act

5. **Webview UI:** `webview-ui/src/components/chat/ChatTextArea.tsx`
   - Бинарный Plan/Act toggle заменён на 4-сегментный control (Plan | Act | Ask | Debug)
   - Каждый режим имеет свой цвет: Plan=жёлтый, Act=синий, Ask=зелёный, Debug=красный
   - Клик по сегменту переключает режим
   - Keyboard shortcut циклит: plan → act → ask → debug → plan
   - Textarea outline цвет соответствует текущему режиму

6. **Webview:** `webview-ui/src/components/common/MarkdownBlock.tsx`
   - Кнопка "Switch to Act Mode" работает из Ask/Plan режимов

7. **i18n:** `webview-ui/src/i18n/locales/en.json` + `ru.json`
   - Добавлены `modeAskDescription` и `modeDebugDescription`

8. **Другое:**
   - `src/core/controller/mcp/downloadMcp.ts` — `isReadOnlyMode()` для проверки
   - `src/services/test/TestServer.ts` — корректная обработка новых режимов

---

## Проверка

### Ask Mode:
1. Переключиться в Ask mode
2. Попросить: "объясни как работает файл X"
3. ИИ должен читать файл и объяснять, НЕ модифицируя
4. Попросить: "исправь баг в файле X"
5. ИИ должен объяснить что нужно исправить, но НЕ делать изменения
6. Должен предложить переключиться в Act mode

### Debug Mode:
1. Переключиться в Debug mode
2. Попросить: "приложение падает при логине"
3. ИИ должен: собрать evidence (прочитать файлы, логи) → сформулировать гипотезы → проверить → предложить фикс
4. Должен объяснять свои шаги (не молча редактировать)
