# Verify V2.1

- app/checkout/page.tsx: PauseState delivery/pickup/dineIn ile başlar.
- lib/server/schnellbestellung.ts: campaignDetails Prisma.InputJsonObject[].
- Opsiyonel badgeText undefined yerine null.
- GitHub scripti typecheck, schnell:test, security:test ve build çalıştırır.
- Hata olursa commit yapılmaz ve repo geri yüklenir.
