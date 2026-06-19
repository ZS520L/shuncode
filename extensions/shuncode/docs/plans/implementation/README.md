# Implementation Plans — Shuncode AI

> Пошаговые инструкции для реализации задач.
> Каждый план написан так, чтобы его мог выполнить менее опытная ИИ-модель.

## Формат плана

Каждый файл `IMPL-XX-название.md` содержит:

1. **Цель** — что делаем и зачем (2-3 предложения)
2. **Результат** — что должно работать после выполнения
3. **Файлы** — точные пути к файлам которые нужно создать/изменить
4. **Шаги** — пронумерованные шаги с конкретным кодом
5. **Проверка** — как убедиться что всё работает

---

## ✅ Все выполненные планы (в `completed/`)

| # | Файл | Задача | Статус |
|---|------|--------|--------|
| 01 | IMPL-01-multilingual-search.md | Мультиязычная embedding модель + адаптивные веса | ✅ |
| 02 | IMPL-02-chat-ux.md | Chat UX: scroll-to-top + ProcessBlock fix | ✅ |
| 03 | IMPL-03-system-prompt.md | Улучшение системного промпта | ✅ |
| 04 | IMPL-04-settings-redesign.md | Settings UI Redesign (9 табов + compact mode) | ✅ |
| 05 | IMPL-05-repo-map.md | Repo Map (regex сигнатуры экспортов в system prompt) | ✅ |
| 06 | IMPL-06-glob-patterns.md | Glob tool для поиска файлов по паттерну | ✅ |
| 07 | IMPL-07-debug-ask-modes.md | Debug Mode + Ask Mode (4 режима, tool filtering, UI) | ✅ |
| 08 | IMPL-08-context-persistence.md | Changelog + Rules (контекст между сессиями) | ✅ |
| 10 | IMPL-10-worker-threads.md | Worker Threads для индексации | ✅ |
| 11 | IMPL-11-i18n.md | Интернационализация (RU + EN) | ✅ |
| 12 | IMPL-12-search-modernization.md | Модернизация поиска | ✅ |
| 13 | IMPL-13-search-quality-fixes.md | Исправления качества поиска | ✅ |
| 15 | IMPL-15-local-web-tools.md | Локальные web_search и web_fetch (без серверного бэкенда) | ✅ |
| 19 | IMPL-19-bugfixes-march-2026.md | Баг-фиксы: rejectAll, codebase_search, поповер, стриминг, diff-ссылки, thinking-блоки | ✅ |

---

## 📋 Оставшиеся планы

| # | Файл | Задача | Часы | Зависимости |
|---|------|--------|------|-------------|
| 09 | IMPL-09-inline-edit.md | Inline Edit (Ctrl+K) | 8-16 | нет |
| 14 | IMPL-14-workflow-steps.md | Multi-Step Workflow Engine | 15-20 дней | нет |
| 16 | IMPL-16-shell-diff-tracking.md | Отслеживание изменений файлов из Shell | 6-20 | нет |
| 17 | IMPL-17-multi-model-system.md | Multi-Agent System (мультиагентная система с воркерами) | 18-25 дней | нет (IMPL-14 опционально) |
| 18 | IMPL-18-billing-licensing.md | Биллинг и лицензирование (организации, трекинг, оплата) | 10-15 дней | нет |
