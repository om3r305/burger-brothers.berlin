BurgerBrothers — Tek ZIP Güncelleme (v1)
========================================

Kopyalama yolları
-----------------
- components/store.ts           → ./components/store.ts
- lib/pricing.ts                → ./lib/pricing.ts
- lib/settings.ts               → ./lib/settings.ts
- lib/campaigns-compat.ts       → ./lib/campaigns-compat.ts
- components/ThemeApply.tsx     → ./components/ThemeApply.tsx
- app/admin/settings/page.tsx   → ./app/admin/settings/page.tsx

Root layout'a ThemeApply ekleyin (tek satır entegrasyon):
--------------------------------------------------------
import ThemeApply from "@/components/ThemeApply";
// <body> içinde:
<ThemeApply />

Admin Settings:
---------------
/admin/settings — tüm ayarlar LocalStorage anahtarı `bb_settings_v1`

Sürüm: 2025-09-28T22:24:58.381125Z
