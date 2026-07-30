Telegram entegrasyonu düzeltildi ✅

Yapılan değişiklikler (tasarımı/diğer akışları bozmadan):
1) lib/telegram.ts
   - API yolu `/api/telegram` → `/api/telegram/send` olarak düzeltildi (gerçek route ile eşleşiyor).

2) app/admin/settings/page.tsx
   - TELEGRAM bölümüne **"Botu Test Et"** butonu eklendi.
   - Buton mevcut formdaki Bot Token & Chat ID ile `/api/telegram/send`'e test mesajı yollar.
   - Başarı/başarısızlık uyarı penceresiyle bildirilir.

Server-side route:
- app/api/telegram/send/route.ts mevcut; token/chatId/text body’den alıp Telegram'a postlar.

Hızlı doğrulama:
- Admin → Ayarlar → Telegram: Aktif ✔, Token ve Chat ID doldur.
- "Botu Test Et" butonuna bas: Telegram’a "Testnachricht ✅ (Burger Admin Settings)" düşmeli.
- Checkout’tan sipariş verince Telegram bildirimi de düşer (Checkout, sendTelegramNewOrder kullanıyor).

Not:
- ENV kullanmak istiyorsanız route bu sürümde body’den aldığı için opsiyoneldir.
