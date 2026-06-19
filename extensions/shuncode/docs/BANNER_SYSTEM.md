# Система баннеров — клиентская часть (расширение)

## Обзор

Расширение получает баннеры с сервера (`GET /banners/v1/messages`) и отображает их двумя способами:

- **Карусель** (`placement: "banner"`) — карточки на Welcome Screen
- **Модалка** (`placement: "modal"`) — диалог поверх всего UI, только для Free-пользователей

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `src/services/banner/BannerService.ts` | Фетч баннеров с сервера, кеш (1 час), фильтрация по провайдеру, dismiss |
| `src/shared/ShuncodeBanner.ts` | Типы API-ответа: `Banner`, `BannersResponse`, `BannerRules` |
| `src/shared/shuncode/banner.ts` | Типы для UI: `BannerCardData`, `BannerAction`, `BannerActionType`, `BANNER_DATA` |
| `webview-ui/src/utils/bannerUtils.tsx` | Конвертация `BannerCardData` → `BannerData` (для компонента) |
| `webview-ui/src/components/common/BannerCarousel.tsx` | UI-карусель с автопрокруткой и dismiss |
| `webview-ui/src/components/common/PromoBannerModal.tsx` | Модалка для Free-пользователей |
| `webview-ui/src/components/chat/ChatView.tsx` | Логика показа модалки (Free-проверка, таймер 7 дней) |
| `webview-ui/src/components/chat/chat-view/components/layout/WelcomeSection.tsx` | Сборка баннеров для карусели, фильтрация modal |

## Поток данных

```
Controller.getBanners()
  → BannerService.getActiveBanners()
    → GET /banners/v1/messages?ide=vscode&os=windows
    → фильтрация по провайдеру (клиентская)
    → фильтрация dismissed
    → convertToBannerCardData() — добавляет placement
  → ExtensionState.banners[]
    ├── WelcomeSection: banners.filter(placement !== "modal") → BannerCarousel
    └── ChatView: banners.find(placement === "modal") → PromoBannerModal (если Free)
```

## Кеширование

- `CACHE_DURATION_MS = 60 * 60 * 1000` (1 час)
- Кеш сбрасывается при dismiss баннера

## Логика модалки (PromoBannerModal)

Хранение состояния: `localStorage` ключ `shuncode_promo_modal`

```json
{ "lastBannerId": "donate-v1", "lastShownAt": 1708700000000 }
```

Правила показа:
1. Пользователь не залогинен (`shuncodeUser === null`) → Free
2. Есть баннер с `placement: "modal"`
3. Либо ID изменился → показать сразу
4. Либо прошло 7 дней с последнего показа → показать снова

## Типы действий (BannerActionType)

| Тип | Что делает | arg |
|-----|-----------|-----|
| `link` | Открыть URL | URL |
| `show-api-settings` | Перейти в настройки API | — |
| `show-feature-settings` | Перейти в настройки фич | — |
| `show-account` | Открыть авторизацию | — |
| `set-model` | Установить модель | model ID |
| `install-cli` | Установить CLI | — |

## Dismiss

- Карусель: крестик на последнем баннере, сохраняется в `globalState.dismissedBanners[]`
- Модалка: кнопка "ОК", сохраняется в `localStorage` (не dismiss, а таймер повтора)
