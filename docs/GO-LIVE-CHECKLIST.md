# Burger Brothers — Production Go-Live Gate

Bu kontrol listesi tamamlanmadan production deploy yapılmamalıdır.

## Dış sistem ve secret işlemleri

- ZIP içinde daha önce paylaşılmış admin/TV/driver PIN ve parolalarını değiştir.
- Eski print-agent/proxy token'larını iptal et; iki servise aynı yeni, en az 32
  karakterlik `PRINT_PROXY_TOKEN` tanımla.
- `SESSION_SECRET`, `CRON_SECRET`, `BOOTSTRAP_MIGRATION_TOKEN`,
  `ANALYTICS_IP_SECRET` ve `BACKUP_ENCRYPTION_KEY` değerlerini secret store'da
  üret; kaynak dosyaya yazma.
- Admin Authenticator uygulamasına yeni `ADMIN_TOTP_SECRET` kaydet; kurtarma
  prosedürünü iki yetkili kişiyle test et.
- `SESSION_VERSION` değerini eski oturumları kapatmak için artır.

## Veritabanı ve deployment

- Staging PostgreSQL üzerinde `prisma migrate deploy` çalıştır.
- Mevcut veri için migration ön kontrolü ve yedek al.
- CI'da typecheck, bütün güvenlik/regression testleri, production build ve
  `npm audit --audit-level=high` yeşil olmalı.
- Vercel deployment commit/hash değerini onaylanan kaynak artifact ile eşleştir.
- Upstash/uyumlu Redis rate limiter tanımlı ve `RATE_LIMIT_REQUIRE_REMOTE=1`
  olmalı.

## Veri koruma ve yedek

- Supabase backup bucket private olmalı.
- Şifreli backup üretimini ve ayrı ortamda restore dry-run'ını test et.
- 90 günlük sipariş PII, 365 günlük müşteri PII, 30 günlük analytics ve 7 günlük
  tracking saklama değerlerini işletme/avukat kararıyla onayla.
- Datenschutzerklärung ve Impressum'daki işletmeci, temsilci, vergi/register
  bilgilerini hukuk danışmanıyla doğrula.
- Stripe, Vercel, Supabase, Cloudinary/R2 ve diğer sağlayıcılar için gerekli
  sözleşme/veri aktarım değerlendirmelerini tamamla.

## Kasa/TSE kararı

- Mali müşavirle uygulamanın elektronik kayıt sistemi sınırını yazılı belirle.
- Harici sertifikalı kasa kullanılıyorsa
  `FISCAL_OPERATION_MODE=external_certified_pos` ve `FISCAL_POS_NAME` tanımla;
  her nakit/yerinde işlemin kasa sistemine aktarım prosedürünü ve mutabakatını
  test et.
- Bu uygulamanın bastığı belge `KEIN STEUERBELEG` olarak işaretlenir; sertifikalı
  mali fişin yerine geçmez.
- Yalnız webshop istisnasına dayanılıyorsa
  `FISCAL_OPERATION_MODE=webshop_only` kararını ve sahadaki gerçek işleyişi
  ayrıca doğrula.

## Fiziksel/operasyonel kabul

- Print proxy yalnız `127.0.0.1` üzerinde dinlemeli; tokensız istek 401 olmalı.
- Normal sipariş, aynı idempotency anahtarıyla tekrar sipariş ve farklı payload
  çakışması gerçek PostgreSQL üzerinde test edilmeli.
- Engelli müşteri, sipariş durum matrisi, iptal/iade ve saatlik refund
  reconciliation test edilmeli.
- Berlin yaz/kış/DST, planlı sipariş, delivery/pickup ve kapalı gün senaryoları
  gerçek çalışma saatleriyle kabul edilmeli.
- Reward fotoğrafı süre sonunda erişilememeli ve en geç bir sonraki saatlik
  cleanup'ta fiziksel olarak silinmeli.
