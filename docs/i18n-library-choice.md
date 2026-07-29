# i18n library choice: next-intl vs react-i18next

Carbon Ledger’s frontend uses **next-intl** for internationalization.

| Criterion | next-intl | react-i18next |
|-----------|-----------|---------------|
| Next.js App Router | First-class plugin, `NextIntlClientProvider`, server `getRequestConfig` | Works via client hooks; no official Next.js integration |
| Message loading | JSON namespaces, typed keys with TypeScript | JSON via `i18next` backends |
| Routing | Optional locale segments and middleware | Typically manual or separate routing |
| Bundle size | Focused on Next.js apps | Larger core (`i18next` + `react-i18next`) |

We chose **next-intl** because the app is Next.js 16 with the App Router, we want a single provider at the root (client locale from `localStorage`, no URL prefix for now), and the API (`useTranslations`, ICU-style placeholders) fits component-level strings in marketplace and retirement flows.
