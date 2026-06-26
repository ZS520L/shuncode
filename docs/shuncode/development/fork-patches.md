> **Русская версия:** [fork-patches.md](../ru/development/fork-patches.md)

# VS Code Fork Patches

All modifications to the VS Code core are marked with `SHUNCODE_FORK_BEGIN` / `SHUNCODE_FORK_END` or `[SHUNCODE]` comments.

To find all patches: `git grep "SHUNCODE_FORK\|[SHUNCODE]" -- src/ build/`

## Modified Core Files

### 1. `product.json` — Branding & Configuration
- `nameShort` / `nameLong` → "Shuncode"
- `applicationName` → "shuncode", `dataFolderName` → ".shuncode"
- `extensionAllowedProposedApi` → `["shuncode.shuncode"]` (for editorInsets)
- `defaultChatAgent` → points to disabled placeholder (disables Copilot)

### 2. `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts`
Disabled the built-in Copilot Chat view. Container renamed to "Shuncode", Copilot view descriptor commented out. The container remains in the AuxiliaryBar for the Shuncode webview.

**Merge risk: HIGH** — Microsoft actively develops the chat feature.

### 3. `src/main.ts` — Default Locale
Default locale set to `ru` with auto-patching of `argv.json`.

### 4. `src/vs/base/node/nls.ts` — Language Pack Bootstrap
Auto-generates `languagepacks.json` from the built-in language pack on first launch. Eliminates the "first launch in English, needs restart" problem.

### 5. `src/vs/workbench/api/browser/viewsExtensionPoint.ts`
Added fallback in `getViewContainer()` to resolve core containers by direct ID. Without this, extensions can't register views in core containers like `workbench.panel.chat`.

### 6. `src/vs/workbench/api/common/extHostCodeInsets.ts`
Fixed View Zone inset positioning (removed `+1` to `line` parameter). Without this fix, diff Accept/Reject buttons render one line below the correct position.

### 7. `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupContributions.ts`
Disabled the Copilot Code Actions Provider (Fix, Explain, Generate from error hovers).

### 8. `src/vs/editor/contrib/hover/browser/markerHoverParticipant.ts`
Removed the "✨ Fix (Ctrl+I)" button from error hovers. Shuncode uses Quick Fix menu instead.

### 9. `build/filters.ts`
Excluded `extensions/shuncode/**` from upstream copyright header checks.

### 10. `build/hygiene.ts`
Allowed Unicode in comments (Cyrillic) by stripping comments before the Unicode check.

## Added Extensions

### `extensions/vscode-language-pack-ru/`
Built-in Russian language pack. Activated automatically via `bootstrapBuiltInLanguagePack()` in `nls.ts`. Works from first launch without restart.

## Updating Upstream

```bash
git remote add upstream https://github.com/microsoft/vscode.git
git fetch upstream --tags
git checkout -b merge/1.110.0
git merge 1.110.0

# Resolve conflicts — look for our markers:
git grep "SHUNCODE_FORK" -- src/ build/
```

### Post-Merge Checklist

- [ ] `product.json` — name is "Shuncode", `extensionAllowedProposedApi` includes `shuncode.shuncode`
- [ ] Copilot Chat view is NOT registered
- [ ] `main.ts` — locale defaults and argv.json patch intact
- [ ] `nls.ts` — `bootstrapBuiltInLanguagePack()` present
- [ ] `viewsExtensionPoint.ts` — `getViewContainer` fallback present
- [ ] `extHostCodeInsets.ts` — no `+1` to line
- [ ] Build succeeds, Shuncode panel opens, UI is in Russian on first launch
