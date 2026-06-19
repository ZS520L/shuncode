# VS Code Fork: Список патчей ядра

> Все наши правки помечены маркерами `SHUNCODE_FORK_BEGIN` / `SHUNCODE_FORK_END` или `[SHUNCODE]`.
> При обновлении upstream: `git grep "SHUNCODE_FORK\|[SHUNCODE]" -- src/ build/` покажет все наши изменения.
> Обновлено: 2026-03-02

---

## Изменённые файлы ядра

### 1. `product.json`
**Что:** Брендинг + конфигурация
- `nameShort` / `nameLong` → "Shuncode"
- `applicationName` → "shuncode"
- `dataFolderName` → ".shuncode"
- `urlProtocol` → "shuncode"
- `extensionAllowedProposedApi` → `["shuncode.shuncode"]` (для editorInsets)
- `defaultChatAgent` → указывает на `disabled.shuncode-placeholder` (отключает Copilot)
- `configurationDefaults` → `chat.commandCenter.enabled: false`

**Риск конфликта при обновлении:** НИЗКИЙ — файл обычно не меняется радикально

---

### 2. `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts`
**Что:** Отключён встроенный Copilot Chat view
- Контейнер `workbench.panel.chat` переименован: title → `{ value: 'Shuncode', original: 'Shuncode' }` (без `localize2`, чтобы русская локализация не перезаписывала на "Чат")
- `chatViewDescriptor` закомментирован (Copilot Chat view не регистрируется)
- Контейнер оставлен в AuxiliaryBar — в него регистрируется webview Shuncode из расширения
- Удалены неиспользуемые импорты: `ChatViewPane`, `KeyCode`, `KeyMod`, `IViewDescriptor`, `ContextKeyExpr`, `localize2`

**Риск конфликта при обновлении:** ВЫСОКИЙ — Microsoft активно развивает chat. При мерже:
1. Проверить что `chatViewContainer` всё ещё существует
2. Убедиться что Copilot view descriptor не регистрируется
3. Если Microsoft реорганизовал файл — искать `registerViews` и комментировать

---

### 3. `src/main.ts`
**Что:** Дефолтная локаль `ru` + автопатч argv.json
- В `createDefaultArgvConfigSync()` — шаблон `argv.json` содержит `"locale": "ru"`
- В `getUserDefinedLocale()` — fallback `return 'ru'` если locale не задан нигде
- В `readArgvConfigSync()` — если `argv.json` существует, но `locale` не задан, дописывает `"locale": "ru"` и пересоздаёт объект через spread (`{ ...argvConfig, locale: 'ru' }`)

**Маркеры:** `SHUNCODE_FORK_BEGIN: ensure Russian locale by default`, `[SHUNCODE] Default UI language`, `[SHUNCODE] Default to Russian`

**Риск конфликта при обновлении:** НИЗКИЙ — шаблон argv.json и getUserDefinedLocale меняются редко

---

### 4. `src/vs/base/node/nls.ts`
**Что:** Автогенерация `languagepacks.json` из встроенного языкового пакета при первом запуске
- В `resolveNLSConfiguration()` — если `languagePacks` не найден или не содержит нужный язык, вызывается `bootstrapBuiltInLanguagePack()`
- `bootstrapBuiltInLanguagePack()` — сканирует `extensions/vscode-language-pack-{locale}/`, парсит `package.json`, генерирует `languagepacks.json` в `userDataPath`
- Решает проблему "первый запуск на английском, нужен перезапуск" — теперь русский сразу

**Маркер:** `SHUNCODE_FORK_BEGIN: bootstrap language pack from built-in extension on first launch`

**Риск конфликта при обновлении:** СРЕДНИЙ — если Microsoft изменит формат languagepacks.json или NLS-пайплайн

---

### 5. `src/vs/workbench/api/browser/viewsExtensionPoint.ts`
**Что:** Фикс резолва view container по прямому ID
- В методе `getViewContainer()` добавлен fallback: `|| this.viewContainersRegistry.get(value)`
- Без этого расширения не могут регистрировать views в core-контейнерах (например `workbench.panel.chat`)
- Оригинальный код искал только по `workbench.view.extension.{value}` — не находил core-контейнеры

**Маркер:** `[SHUNCODE] Fallback: also try the raw value`

**Риск конфликта при обновлении:** СРЕДНИЙ — метод может измениться если Microsoft добавит новые well-known контейнеры

---

### 6. `src/vs/workbench/api/common/extHostCodeInsets.ts`
**Что:** Фикс позиционирования View Zone insets
- Убран `+1` к параметру `line` при создании `WebviewEditorInset`
- Без этого фикса diff-кнопки Accept/Reject отображаются на строку ниже

**Риск конфликта при обновлении:** СРЕДНИЙ — файл редко меняется, но если API insets изменится — проверить

---

### 7. `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupContributions.ts`
**Что:** Отключён Copilot Code Actions Provider
- `ChatCodeActionsProvider.registerProvider()` заменён на `codeActionsProviderDisposables.clear()`
- Удалён неиспользуемый импорт `ChatCodeActionsProvider`
- Убраны Copilot'овские AI Code Actions (Fix, Explain, Generate) из hover ошибок

**Маркер:** `SHUNCODE_FORK_BEGIN: disable Copilot Code Actions Provider`

**Риск конфликта при обновлении:** НИЗКИЙ

---

### 8. `src/vs/editor/contrib/hover/browser/markerHoverParticipant.ts`
**Что:** Убрана кнопка "✨ Fix (Ctrl+I)" из hover ошибок
- Удалён блок рендера AI code action (sparkle icon + `isAI`)
- Удалены неиспользуемые импорты: `ApplyCodeActionReason`, `ThemeIcon`, `Codicon`
- Shuncode использует Quick Fix меню (Ctrl+.) → "Fix with Shuncode"

**Маркер:** `SHUNCODE_FORK_BEGIN: remove Copilot "Fix" button from error hover`

**Риск конфликта при обновлении:** НИЗКИЙ

---

### 9. `build/filters.ts`
**Что:** Исключение расширения shuncode из проверки copyright-заголовков
- Добавлено `'!extensions/shuncode/**'` в фильтр

**Маркер:** `SHUNCODE_FORK_BEGIN: keep shuncode files exempt from upstream copyright header check`

**Риск конфликта при обновлении:** НИЗКИЙ

---

### 10. `build/hygiene.ts`
**Что:** Разрешение Unicode в комментариях (кириллица)
- Добавлена функция `stripComments()` для удаления комментариев перед проверкой Unicode
- Проверка Unicode пропускает содержимое комментариев — можно писать русские комменты

**Маркер:** `SHUNCODE_FORK_BEGIN: helper for unicode check with comment stripping`, `SHUNCODE_FORK_BEGIN: allow any unicode in comments`

**Риск конфликта при обновлении:** НИЗКИЙ

---

## Изменения в расширении Shuncode

### `extensions/shuncode/src/extension.ts`
- Автооткрытие панели Shuncode при первом запуске (`globalState` флаг `shuncode.panelAutoShown`)

**Маркер:** `SHUNCODE_FORK_BEGIN: auto-open Shuncode panel on first launch`

### `extensions/shuncode/src/services/telemetry/TelemetryService.ts`
- Убрано предупреждение "IDE telemetry is disabled" — в OSS-сборке телеметрия выключена по умолчанию, нагонять на пользователя незачем

**Маркер:** `SHUNCODE_FORK_BEGIN: suppress telemetry warning`

### `extensions/shuncode/.vscodeignore`
- Добавлены исключения: `bin/`, `proto/`, `scripts/`, `vendor/whisper/`, dev-файлы
- Экономия ~165 МБ в финальной сборке

### `extensions/shuncode/package.json`
- `views` → перенесён в контейнер `workbench.panel.chat` (правый сайдбар AuxiliaryBar)
- `shuncode-icon` — кастомная иконка (шрифт `shuncode-bot.woff`) для терминалов и UI

### `extensions/shuncode/assets/icons/shuncode-bot.woff` / `shuncode-bot.ttf`
- Шрифтовая иконка с логотипом Shuncode "S" (сгенерирована из SVG через svgicons2svgfont → svg2ttf → ttf2woff)
- Используется как `ThemeIcon("shuncode-icon")` в терминалах, создаваемых агентом

---

## Добавленные расширения

### `extensions/vscode-language-pack-ru/`
**Что:** Русский языковой пакет (built-in)
- Извлечён из `MS-CEINTL.vscode-language-pack-ru-latest.vsix`
- Активируется автоматически через `bootstrapBuiltInLanguagePack()` в `nls.ts`
- Не требует перезапуска — работает с первого запуска

**Риск конфликта при обновлении:** НЕТ — отдельная папка, не конфликтует

---

## Как обновлять upstream

```bash
# 1. Добавить upstream remote (один раз)
git remote add upstream https://github.com/microsoft/vscode.git

# 2. Получить новую версию
git fetch upstream --tags

# 3. Найти стабильный тег (например 1.110.0)
git tag -l '1.1*' | sort -V | tail -5

# 4. Создать ветку для мержа
git checkout -b merge/1.110.0

# 5. Мерж
git merge 1.110.0

# 6. Разрулить конфликты — искать наши маркеры
git grep "SHUNCODE_FORK" -- src/ build/

# 7. Проверить ключевые файлы:
#    - product.json (брендинг)
#    - chatParticipant.contribution.ts (Copilot отключён?)
#    - main.ts (locale: ru, getUserDefinedLocale fallback, readArgvConfigSync патч)
#    - nls.ts (bootstrapBuiltInLanguagePack)
#    - viewsExtensionPoint.ts (getViewContainer fallback)
#    - extHostCodeInsets.ts (фикс +1)
#    - chatSetupContributions.ts (ChatCodeActionsProvider убран)
#    - markerHoverParticipant.ts (кнопка Fix убрана)

# 8. Пересобрать
npm run gulp -- vscode-win32-x64-min
```

---

## Как собрать production-билд (Windows)

```powershell
# 1. Собрать webview-ui
cd vscode\extensions\shuncode\webview-ui
npm run build

# 2. Собрать расширение
cd ..
node esbuild.mjs

# 3. Обфусцировать (8 ГБ RAM для node)
node --max-old-space-size=8192 "C:\Users\Admin\AppData\Roaming\npm\node_modules\javascript-obfuscator\bin\javascript-obfuscator" dist/extension.js --output dist/extension.obf.js --compact true --string-array false --rename-globals false --identifier-names-generator hexadecimal --numbers-to-expressions true --simplify true --unicode-escape-sequence true
Copy-Item dist\extension.obf.js dist\extension.js -Force
Remove-Item dist\extension.obf.js

# 4. Собрать VS Code
cd ..\..
node --max-old-space-size=8192 node_modules\gulp\bin\gulp.js vscode-win32-x64-min

# 5. Результат в ../VSCode-win32-x64/Shuncode.exe
```

**Примечание по обфускации:** файл ~44 МБ, `string-array` и `split-strings` вызывают OOM или `URI malformed`. Рабочий набор: `--unicode-escape-sequence true --identifier-names-generator hexadecimal --numbers-to-expressions true --simplify true`.

---

## Оптимизация размера сборки

Выполнено 2026-02-24. Итог: **2.85 ГБ → 0.84 ГБ**.

| Что удалено/исключено | Экономия |
|---|---|
| 7 дублей ONNX-моделей (`paraphrase-multilingual`) | −1,839 МБ |
| `vendor/whisper/ggml-base.bin` (не нужен, base скачивается с сервера) | −141 МБ |
| `bin/` (protoc.exe, только для разработки) через `.vscodeignore` | −22 МБ |
| `proto/`, `scripts/`, dev-файлы через `.vscodeignore` | −0.6 МБ |
| `extension.js.bak` | −44 МБ |

**Что осталось в расширении (405 МБ):**
- `models/` — 153 МБ (2 модели, только `model_quantized.onnx`)
- `assets/voice/` — 149 МБ (whisper tiny zip)
- `dist/` — 96 МБ (обфусцированный extension.js + tree-sitter wasm)
- `webview-ui/build/` — 6 МБ (React UI)
- `vendor/modules/` — 0.8 МБ (transformers.js)

---

## Чеклист после обновления

- [ ] `product.json` — имя "Shuncode", `extensionAllowedProposedApi` содержит `shuncode.shuncode`
- [ ] Copilot Chat view НЕ регистрируется (`chatParticipant.contribution.ts`)
- [ ] `main.ts` — `argv.json` шаблон: `"locale": "ru"`, `getUserDefinedLocale` fallback → `'ru'`, `readArgvConfigSync` патчит существующий argv.json
- [ ] `nls.ts` — `bootstrapBuiltInLanguagePack()` на месте
- [ ] `viewsExtensionPoint.ts` — `getViewContainer` имеет fallback на прямой ID
- [ ] `extHostCodeInsets.ts` — нет `+1` к line
- [ ] `chatSetupContributions.ts` — `ChatCodeActionsProvider` удалён из импорта, `codeActionsProviderDisposables.clear()`
- [ ] `markerHoverParticipant.ts` — импорты `ApplyCodeActionReason`, `ThemeIcon`, `Codicon` удалены
- [ ] `build/filters.ts` — `!extensions/shuncode/**`
- [ ] `build/hygiene.ts` — `stripComments()` + unicode в комментариях разрешён
- [ ] `extensions/vscode-language-pack-ru/` на месте
- [ ] `extensions/shuncode/package.json` → views в `workbench.panel.chat`
- [ ] `extensions/shuncode/.vscodeignore` — `bin/`, `proto/`, `scripts/`, `vendor/whisper/` исключены
- [ ] Сборка проходит без ошибок
- [ ] Shuncode.exe запускается, панель Shuncode открыта
- [ ] UI на русском языке с первого запуска (без перезапуска)

---

## Новая подсистема: Система разрешений и безопасности (Permissions)

Добавлена 2026-03-02. Аудит и усиление безопасности auto-approval настроек.

### Что было
- Настройки `readFiles`, `editFiles` в UI были **пустышками** — файлы всегда читались автоматически, редактирование шло через DiffSystem (inline diffs с Accept/Reject), поэтому галочки ни на что не влияли.
- `executeSafeCommands` / `executeAllCommands` — команды выполнялись автоматически без approval (`didAutoApprove = true` был захардкожен).
- `deleteFiles` — удаление файлов не имело UI-настройки, шло через старый `confirmDeleteFile` (не был экспортирован в UI).
- `editNotebooks` — редактирование `.ipynb` файлов не имело approval, записывались напрямую.
- `Checkpoints` — галочка в UI, но система отключена в `task/index.ts` (закомментирована).

### Что сделано

**Убрано из UI (dead code, backend сохранён):**
- `readFiles` / `readFilesExternally` — убраны из `ACTION_METADATA` в `constants.ts`
- `editFiles` / `editFilesExternally` — убраны из `ACTION_METADATA`
- `Checkpoints` — убрана галочка из `EditingSection.tsx`

Код в `AutoApprovalSettings.ts` и `autoApprove.ts` сохранён для обратной совместимости.

**Добавлено:**
- `deleteFiles` — настройка auto-approval удаления файлов (default: `false`)
- `editNotebooks` — настройка auto-approval редактирования Jupyter блокнотов (default: `false`)
- `executeSafeCommands` / `executeAllCommands` — реализована реальная логика approval

**Новые файлы:**
- `src/core/permissions/CommandSafetyClassifier.ts` — классификация команд на safe/unsafe (whitelist-подход)
- `src/core/permissions/CommandSafetyClassifier.test.ts` — тесты (23+)
- `src/core/task/tools/__tests__/autoApprove.test.ts` — тесты AutoApprove
- `src/core/task/tools/handlers/__tests__/DeleteFileToolHandler.test.ts` — тесты approval удаления
- `src/core/task/tools/handlers/__tests__/EditNotebookToolHandler.approval.test.ts` — тесты approval notebooks

**Изменённые файлы:**
- `src/shared/AutoApprovalSettings.ts` — добавлены `deleteFiles`, `editNotebooks`
- `src/core/task/tools/autoApprove.ts` — новые case'ы FILE_DELETE, EDIT_NOTEBOOK
- `src/core/task/tools/handlers/ExecuteCommandToolHandler.ts` — реальная approval логика
- `src/core/task/tools/handlers/DeleteFileToolHandler.ts` — approval через autoApprover
- `src/core/task/tools/handlers/EditNotebookToolHandler.ts` — approval перед записью
- `src/core/task/tools/handlers/ApplyPatchHandler.ts` — approval для DELETE операций в patch
- `webview-ui/src/components/chat/auto-approve-menu/constants.ts` — новые пункты UI
- `webview-ui/src/components/settings/sections/EditingSection.tsx` — убрана галочка Checkpoints
- `webview-ui/src/i18n/locales/en.json` — ключи deleteFiles, editNotebooks
- `webview-ui/src/i18n/locales/ru.json` — ключи deleteFiles, editNotebooks

**Маркеры:** `[SHUNCODE]` в изменённых файлах

---

## Новая подсистема: Индексация кодовой базы

Подробная документация: [`docs/INDEXING_SYSTEM.md`](./INDEXING_SYSTEM.md)

Добавлена полная система семантической индексации:
- Локальные эмбеддинги через transformers.js (WASM, офлайн)
- Опция удалённого API (OpenAI-compatible)
- Хранение: SQLite (`index.db`) с fallback на JSON/binary (`~/.shuncode/indexing/`)
- FileWatcher для инкрементальных обновлений
- SearchEngine: hybrid retrieval (semantic + keyword) + rerank
- Инструмент агента `codebase_search` (tool spec + handler + регистрация в prompt variants)
- UI таб "Индексация" в настройках Shuncode
