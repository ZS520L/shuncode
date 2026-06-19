> **English version:** [fork-patches.md](../../development/fork-patches.md)

# Патчи форка VS Code

Все изменения в ядре VS Code помечены комментариями `SHUNCODE_FORK_BEGIN` / `SHUNCODE_FORK_END` или `[SHUNCODE]`.

Найти все патчи: `git grep "SHUNCODE_FORK\|[SHUNCODE]" -- src/ build/`

## Изменённые файлы ядра

### 1. `product.json` — брендинг и конфигурация

- `nameShort` / `nameLong` → "Shuncode"
- `applicationName` → "shuncode", `dataFolderName` → ".shuncode"
- `extensionAllowedProposedApi` → `["shuncode.shuncode"]` (для editorInsets)
- `defaultChatAgent` → указывает на отключённый заглушечный агент (отключает Copilot)

### 2. `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts`

Отключено встроенное представление Copilot Chat. Контейнер переименован в "Shuncode", дескриптор представления Copilot закомментирован. Контейнер остаётся в AuxiliaryBar для webview Shuncode.

**Риск при мерже: высокий** — Microsoft активно развивает чат.

### 3. `src/main.ts` — локаль по умолчанию

Локаль по умолчанию — `ru`, с автопатчем `argv.json`.

### 4. `src/vs/base/node/nls.ts` — загрузка language pack

Автоматически генерирует `languagepacks.json` из встроенного language pack при первом запуске. Убирает проблему «первый запуск на английском, нужен перезапуск».

### 5. `src/vs/workbench/api/browser/viewsExtensionPoint.ts`

В `getViewContainer()` добавлен fallback: разрешение core-контейнеров по прямому ID. Без этого расширения не могут регистрировать представления в core-контейнерах вроде `workbench.panel.chat`.

### 6. `src/vs/workbench/api/common/extHostCodeInsets.ts`

Исправлено позиционирование View Zone inset (убран `+1` у параметра `line`). Без этого кнопки Accept/Reject в diff рисуются на строку ниже нужной.

### 7. `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupContributions.ts`

Отключён Copilot Code Actions Provider (Fix, Explain, Generate из ховеров ошибок).

### 8. `src/vs/editor/contrib/hover/browser/markerHoverParticipant.ts`

Убрана кнопка "✨ Fix (Ctrl+I)" из ховеров ошибок. Shuncode использует меню Quick Fix.

### 9. `build/filters.ts`

Исключён `extensions/shuncode/**` из проверок upstream copyright header.

### 10. `build/hygiene.ts`

Разрешён Unicode в комментариях (кириллица): комментарии вырезаются перед проверкой Unicode.

## Добавленные расширения

### `extensions/vscode-language-pack-ru/`

Встроенный русский language pack. Активируется автоматически через `bootstrapBuiltInLanguagePack()` в `nls.ts`. Работает с первого запуска без перезапуска.

## Обновление upstream

```bash
git remote add upstream https://github.com/microsoft/vscode.git
git fetch upstream --tags
git checkout -b merge/1.110.0
git merge 1.110.0

# Разрешить конфликты — искать наши маркеры:
git grep "SHUNCODE_FORK" -- src/ build/
```

### Чеклист после мержа

- [ ] `product.json` — имя "Shuncode", в `extensionAllowedProposedApi` есть `shuncode.shuncode`
- [ ] Представление Copilot Chat не регистрируется
- [ ] `main.ts` — дефолтная локаль и патч argv.json на месте
- [ ] `nls.ts` — присутствует `bootstrapBuiltInLanguagePack()`
- [ ] `viewsExtensionPoint.ts` — fallback в `getViewContainer` на месте
- [ ] `extHostCodeInsets.ts` — нет `+1` к `line`
- [ ] Сборка проходит, панель Shuncode открывается, UI на русском с первого запуска
