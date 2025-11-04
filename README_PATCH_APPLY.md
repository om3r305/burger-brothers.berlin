# Değişiklik Günlüğü (Brian Notes)
Tarih: 2025-10-20 21:20

## Yapılan Güvenli Düzeltmeler (işleyişi bozmaz)
1) **package.json** script düzeni:
   - `dev` artık **`next dev`**.
   - `dev:https` ile eski `node server.js` korunur (lokal HTTPS isteyenler için).
   - `dev:next` kısa yol olarak eklendi.

2) **.env.example** eklendi:
   - ADMIN_USER / ADMIN_PASS alanları üretimde zorunlu (varsayılanları kullanmayın).
   - TG_BOT_TOKEN / TG_CHAT_ID alanları telgraf bildirimi için rehber amaçlı eklendi.

3) Dosya yapısı/işleyişe müdahale edilmedi; yalnızca güvenli & uyumlu script/ENV iyileştirmesi yapıldı.

## Sonraki Paket (öneri)
- DE-only i18n temizlik (Admin Settings/Checkout sabitleri i18n/de.json’a taşıma).
- Kart grid uniform: resimsiz kartlarda sabit min-height & footer hizası.
- Telegram mesajına moda göre ETA etiketi.
- Kalıcı Depo (DB) adaptörü (serverless için JSON yerine).



## Paket 2 — i18n + Kart Uniform + Telegram ETA
Tarih: 2025-10-20 21:25
- **Admin/Settings gün adları (TR→DE):** Pazartesi→Montag ... Pazar→Sonntag.
- **Checkout / Kupon mesajları:** Türkçe kalmış görünen etiketler Almancaya çekildi (Gutscheincode, Ungültig vb.).
- **Kart grid uniform:** 
  - `components/ui/ItemCard.tsx` → `flex flex-col min-h-[380px]` + CTA sarmalayıcı `mt-auto`.
  - `components/shared/VariantGroupCard.tsx` → `flex flex-col min-h-[380px]` + CTA `mt-auto`.
  - `components/sauces/SauceCard.tsx` → dış kapsayıcıya `min-h-[380px]`, footer `mt-auto`.
  - `components/extras/ExtraCard.tsx` zaten `min-h-[420px]` ve `mt-auto` idi, dokunulmadı.
- **Telegram mesajı:** `lib/telegram.ts` içinde moda göre **ETA** satırı eklendi
  (Abholung: `hours.avgPickupMinutes` varsayılan 15; Lieferung: `hours.avgDeliveryMinutes` varsayılan 35).


## Paket 3 — i18n temizliği (geniş)
Tarih: 2025-10-20 21:26
- Kod tabanında kalan yaygın TR etiketleri Almancaya taşındı (Gutscheincode, Ungültig, Entfernen, Adresse, Straße, Etage, Hinweis, Bestellung abschließen vb.).
- ItemCard/CTA hizaları idempotent kontrol edilip korundu.
- (Not) Geniş kapsamlı i18n için sonraki adım: tüm sabit metinlerin `i18n/de.json` altında toplanması (mevcut literal’ler tek tek taşınacak).


## Paket 4 — i18n util + Checkout parlatma + Admin guard + DB scaffold
Tarih: 2025-10-20 21:28
- **i18n util:** `lib/i18n.ts` eklendi; ana etiketler `i18n/de.json` üzerinden `t('...')` ile okunuyor.
- **Checkout & Kupon:** görünür etiketler ve mesajlar i18n'e bağlandı, kısa-öz Almanca.
- **Admin guard:** prod'da default credential reddi + basit IP başına rate-limit (5 dk / 20 deneme).
- **DB adapter scaffold:** `lib/server/db.ts` ile mevcut JSON yazma/okuma katmanı soyutlandı; ileride SQLite/Prisma/Redis kolay entegrasyon.


## Paket 5 — i18n derinleştirme + Kupon UX + Settings şeması
Tarih: 2025-10-20 21:29
- **i18n genişletildi:** cart/coupon/buttons grupları eklendi; ortak başlıklar ve toplam alanları i18n’e bağlandı.
- **Kupon UX:** tek aktif kupon için `değiştirilsin mi?` onayı (Almanca) eklendi; kaldır/aktif/invalid mesajları i18n’den.
- **Settings Schema (scaffold):** `config/settings.schema.json` eklendi, Admin formu ileride bu şemadan otomatik üretilebilir.
- Tüm değişiklikler **işleyişi bozmaz** nitelikte; mevcut veri/akış korunmuştur.


## Paket 6 — Admin Settings: Şema-tabanlı form (non-breaking)
Tarih: 2025-10-20 21:31
- **Yeni:** `components/admin/SchemaForm.tsx` — JSON Schema'dan (config/settings.schema.json) otomatik form üretir.
- **Settings Page entegrasyonu:** mevcut manuel form KALDI; altta ek bir bölüm olarak `Schema-basiertes Formular` görünüyor.
- Bu bölüm üzerinden yapılan değişiklikler, mevcut ayarlara **birleştirilerek** (`readSettings` + `writeSettings`) kaydedilir.
- Böylece yeni alan eklemek için yalnız şemayı güncellemek yeterli olur.


## Paket 7 — SchemaForm (enum/array/help) + Kupon rozeti + KV rate-limit + Opsiyonel SQLite
Tarih: 2025-10-20 21:32
- **SchemaForm**: enum/select, string dizileri (ekle/sil), description/help-text desteği eklendi.
- **Schema**: örnek alanlar için enum/array + açıklamalar eklendi (`theme.colorScheme`, `theme.badges`).
- **Kupon**: aktif kupon kodu için üstte küçük **rozet** gösterimi.
- **Rate-limit**: server tarafında **file-backed KV** ile IP başına sayaç (5 dk penceresi) — deploy’da kalıcı depolama varsa korunur.
- **DB adapter**: `better-sqlite3` mevcutsa `DB_SQLITE_FILE` ile otomatik SQLite; yoksa JSON’a sorunsuz geri düşer.


## Paket 8 — Checkout mikro-parlatma + SchemaForm arama/toggle + yardım rozetleri + migration notları
Tarih: 2025-10-20 21:33
- **Checkout:** Kupon kaldırmada mini **toast** (*Gutschein entfernt.*); küçük toast util (`components/ui/toast.tsx`).
- **SchemaForm:** arama kutusu, **yalnız değişenleri göster** toggle; enum için label mapping; min/max/pattern yardım rozetleri.
- **Schema:** örnek enumLabel kullanım zemini eklendi (label mapping).
- **Migrations:** `tools/migrations/README_MIGRATIONS.md` ile yönlendirici notlar.


## Paket 9 — Telefon maskesi (checkout) + Prisma scaffold + ENV knobs
Tarih: 2025-10-20 21:35
- **Telefon numarası**: checkout'ta yalnız **rakam** kabulü ve `settings.validation.phoneDigits` ile **tam uzunluk** kontrolü (örn. 11).
- **Prisma**: `prisma/schema.prisma` ve npm scriptleri eklendi (opsiyonel). `DATABASE_URL` verilirse `@prisma/client` ile çalışabilir.
- **db.ts**: Prisma için **opsiyonel async API** (`DBA.read/write`) eklendi; tercih sırası **Prisma → SQLite → JSON** (geri uyumlu).
- **.env.example**: login rate-limit ayarları + SQLite/Prisma ENV alanları eklendi.


## Paket 10 — DBA entegrasyonu (settings/orders/tracking) + Migration util
Tarih: 2025-10-20 21:36
- **Settings server**: `getServerSettings()` artık DBA üzerinden okuyor (Prisma/SQLite varsa onları, yoksa JSON'u kullanır).
- **Orders API**: `create` ve `list` DBA ile çalışır; siparişler kalıcı depoya eklenir.
- **Tracking API**: okuma/yazma DBA'ya taşındı.
- **Migration**: `tools/migrate_json_to_db.ts` (ts-node ile) `/data/*.json` → DBA'ya aktarır.
- Tüm değişiklikler **geri uyumlu** ve mevcut işleyişi bozmaz.


## Paket 12 — Tam DB Aktivasyon (SQLite)
Tarih: 2025-10-20 22:00
- **currentMode()**: aktif depoyu döner (**prisma/sqlite/json**).
- **/api/admin/db/health**: mod + dosya bilgisi verir.
- **tools/activate_sqlite.ts**: `DB_SQLITE_FILE` ile SQLite dosyasını kurar ve `/data/*.json` verilerini DB'ye taşır.
- **npm scripts**: `db:activate:sqlite`, `db:health` eklendi.
- `.env.example` SQLite yolu örneği eklendi.
