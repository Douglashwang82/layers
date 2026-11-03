---
name: add-i18n-copy
description: Add or change LocalLink UI copy in English and Traditional Chinese. Use whenever a change adds visible text, labels, aria-labels, or error messages.
---

# Add UI copy

- Main dictionary: `apps/web/src/lib/dictionary.ts`. `en` is the source of truth; `zh: Copy` must have every key (TypeScript enforces it). Helpers there: `localized()`, `format()`, `dateLabel()`.
- Feature-specific copy files live next to it (e.g. `restaurant-admin-copy.ts`, `map-import-copy.ts`); add to the matching one if the feature already has its own file.
- Add keys near related keys with a feature prefix (`mascotTitle`, `mascotHint`, ...). Use placeholders compatible with `format()` instead of string concatenation.
- Chinese: Traditional characters with Taiwan usage (e.g. 地圖, 圖層, 活動, 收藏), full-width punctuation, no spaces between Chinese and punctuation.
- Use `brand` from `packages/shared/src` for the product name; never hardcode "LocalLink" or "TaiwanHub".
- Never put text straight into JSX, including `aria-label` and `title`.

Run `pnpm typecheck` to confirm both locales have the key.
