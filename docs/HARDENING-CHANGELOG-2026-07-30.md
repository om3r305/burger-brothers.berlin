# Burger Brothers — Hardening Değişiklik Özeti

Bu paket, `burger5(1).zip` ile sonradan iletilen `middleware.zip` birleştirilerek hazırlanmış temiz kaynak teslimidir.

## Durum

- TypeScript: geçti
- Production build: geçti
- `npm run verify`: geçti
- Bağımlılık taraması: 0 bilinen açık
- Toplam bağımsız test dosyası: 56/56 geçti
- Temiz paket artefakt/secret taraması: geçti

## Başlıca değişiklikler

- Kök middleware birleştirildi; eski `public/middleware.ts` kaldırıldı.
- Print proxy loopback, zorunlu token, timing-safe auth, exact CORS, SSRF allowlist, limit ve timeout ile sertleştirildi.
- Admin TOTP, session version/revocation ve sıkı production secret kuralları eklendi.
- Dağıtılmış rate limit production’da fail-closed zorunlu hale getirildi.
- Sipariş idempotency’si, müşteri engelleme ve rol/mode durum geçiş politikası eklendi.
- Refund retry/reconciliation ve kalıcı reward queue eklendi.
- Berlin yaz/kış saati ve ön sipariş hesabı düzeltildi.
- PII retention/anonymization, analytics consent/minimizasyon ve AES-256-GCM backup eklendi.
- Ürün bazlı 7/19 vergi oranı ve DB bütünlük constraint’leri eklendi.
- CI, Dependabot, CODEOWNERS, SECURITY.md, environment validator ve artefakt taraması eklendi.
- Next.js ve güvenlik açısından ilgili bağımlılıklar güncellendi.

## Kurulum

Gerçek secret’ları hiçbir dosyaya veya GitHub’a yazmayın. `.env.example` yalnız sözleşmedir; değerleri hosting secret store’a girin.

```bash
npm ci
npm run env:check -- --production
npm run prisma:generate
npm run prisma:migrate:deploy
npm run verify
npm run build
```

Migration öncesinde doğrulanmış backup alın ve önce staging/kopya DB’de çalıştırın.

## Canlıya geçiş zorunlulukları

- Eski tüm PIN/token/parola/anahtarları rotate edin.
- `FISCAL_OPERATION_MODE` değerini mali müşavir ve gerçek POS/TSE akışına göre seçin.
- Impressum/Datenschutz bilgilerini gerçek işletme bilgileriyle doğrulatın.
- Stripe, Supabase, Redis, medya storage, push, cron ve fiziksel printer smoke testlerini yapın.
- GitHub branch protection içinde CI check’i zorunlu hale getirin.

Tam kontrol listesi için `docs/GO-LIVE-CHECKLIST.md` dosyasını izleyin.
