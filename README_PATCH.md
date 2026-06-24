# Burger Patch v1

Dieses Patch-Paket enthält:
- Server-seitige Bestellanlage + Status + Telegram (kategorisiert)
- Kurze Bestellnummern (6 Zeichen, Buchstaben/Ziffern)
- Dashboard mit Apollon (Abholung) / Lufa (Lieferung), Suche, Statuswechsel, Druck
- Deutlich sichtbares TrackPanel (DE-only)
- Tracking-Seite für Kunden (`/track`)

## Dateien

```
app/
  api/
    orders/
      route.ts           # GET Liste / PATCH Status
      create/route.ts    # POST neue Bestellung, sendet Telegram
      status/route.ts    # GET einzelner Status
  dashboard/page.tsx     # Neues Dashboard
  track/page.tsx         # Kunden-Tracking

components/
  ui/TrackPanel.tsx      # Vurgulu, ikonlu takip kutusu

lib/
  order-id.ts
  telegram.ts            # Kategorili Telegram mesaj formatı
  server/
    db.ts                # einfache JSON-Datei-DB (Dev)
    settings.ts          # Server-Settings (JSON-Datei oder ENV)
```

## Integration

1. **Checkout** (`app/checkout/page.tsx`) – Folgendes sicherstellen:
   - `fetch("/api/orders/create", { method: "POST", body: JSON.stringify({ order, notify: true }) ... })` **behalten**.
   - Türkçe uyarıları DE machen:
     - `alert("Es ist ein Fehler aufgetreten. Bitte erneut versuchen.");`
     - `"Bestellung eingegangen ✅"`, `"Vorbereitungszeit:"`, `"Voraussichtliche Lieferung:"`,
       `"Bestellbestätigung"`, `"Bitte notieren Sie diese Nummer."`,
       `"Kopieren"`, `"OK • Zurück zum Menü"`, `"Schließen"`,
       `"Bestellzusammenfassung wurde kopiert."`
   - WhatsApp ile ilgili tüm kodlar kaldırılmış olmalı.
   - `phoneDigits` ayarı `readSettings().validation.phoneDigits` üzerinden geliyor olmalı (zaten öyle).

2. **Settings (Admin)** – Server'in ayar okuması:
   - ENV fallback: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `AVG_PICKUP_MINUTES`, `AVG_DELIVERY_MINUTES`, `ORDER_ID_LENGTH`.
   - Alternativ: Projektwurzel: `.data/settings.json` mit:
     ```json
     {
       "telegram": { "botToken": "123:ABC", "chatId": "-100..." },
       "hours": { "avgPickupMinutes": 15, "avgDeliveryMinutes": 35 },
       "orders": { "idLength": 6 }
     }
     ```

3. **Dashboard** – `/dashboard` öffnen. Oben Tabs: *Weiterlaufend* / *Abgeschlossen*. 
   - Manuell Status değişimi mümkün.
   - `Drucken` butonu fiş önizleme + `window.print()` tetikler.

4. **Sipariş Takip** – Checkout'ta `<TrackPanel />` kaldı. Müşteri ID'yi girince `/track` sayfasında sunucu durumunu görür.

> Not: Vercel „Edge/Serverless“ gibi salt-okunur dosya sisteminde JSON-DB yazımı çalışmaz. Bu durumda gerçek bir DB (Redis/Postgres) bağlamak gerekir. Lokal / Node sunucuda sorunsuzdur.
