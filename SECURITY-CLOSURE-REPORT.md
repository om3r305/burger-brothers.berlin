# Burger Brothers — Kapsamlı Güvenlik Kapanış Raporu

## Kapsam

Bu teslimat, 17 Temmuz 2026 tarihli teknik incelemedeki uygulama-kodu kaynaklı P0 ve P1 bulgularını kapatmak üzere hazırlandı. Toplam 91 proje dosyası eklenmiş veya güncellenmiştir.

## Kapatılan P0 bulguları

### Legacy `/api/orders`
- Çok amaçlı legacy mutation yolu kapatıldı ve `410 legacy_orders_mutation_disabled` döndürüyor.
- Public sipariş oluşturma yalnızca `/api/orders/create` üzerinden devam ediyor.
- List/status/claim işlemleri imzalı admin/TV/driver oturumlarıyla ayrıldı.
- Driver ve TV istemcilerindeki legacy fallback çağrıları kaldırıldı.

### Ürün ve kupon sahte admin cookie'si
- `startsWith("ok:")` kontrolleri kaldırıldı.
- Mutation route'ları HMAC imzalı admin session ve same-origin kontrolü kullanıyor.

### Bootstrap, catalog, groups ve pause
- Bootstrap production ortamında admin session veya güçlü `BOOTSTRAP_MIGRATION_TOKEN` ister.
- Catalog/groups mutation'ları admin session ister.
- Pause mutation'ı admin veya TV operational session ister.

### Public sipariş verisi / GDPR
- Kısa sipariş koduyla public tam sipariş sorgusu kaldırıldı.
- Müşteri takibi için 32-byte base64url `trackingToken` üretiliyor.
- Public DTO yalnızca durum, ETA, planlı zaman ve güvenli ödeme özeti döndürüyor.
- Telefon, adres, e-posta, ürün detayları, iç notlar ve kurye kimliği public DTO'da yok.

### Tracking
- Konum yazma admin/driver session ister.
- Driver yalnızca kendisine atanmış aktif teslimatlara konum yazabilir.
- Public takip uzun tracking token ister; history ve driver ID dönmez.
- Public tracking TTL ve günlük retention cleanup eklendi.
- Checkout, TrackPanel ve müşteri takip sayfası token tabanlı akışa geçirildi.

### PIN, parola ve gizli dosyalar
- Driver parolaları scrypt + benzersiz salt ile hashleniyor; eski düz kayıtlar ilk okumada migrate ediliyor.
- Public settings allowlist/recursive redaction kullanıyor.
- `.gitignore` env, PEM, DB, snapshot, local print config ve build çıktılarını dışlıyor.
- Güvenli `.env.example` boş değerlerle yenilendi.

## Kapatılan P1 bulguları

### Print
- Print test admin/TV session, rate limit ve production kill switch kullanıyor.
- Proxy varsayılan olarak `127.0.0.1` üzerinde dinliyor.
- Proxy token zorunlu; agent aynı tokeni gönderiyor.
- CORS ve order URL origin allowlist eklendi.
- Print jobs/mark query-string token kabul etmiyor.

### Brian, Telegram ve diagnostics
- Brian learn/export operational auth kullanıyor.
- Telegram test relay yalnızca admin, same-origin ve rate-limit ile çalışıyor.
- Diagnostics minimum operational DTO döndürüyor; TV debug production'da kapalı/admin korumalı.

### Login brute force
- Admin, TV ve driver login yollarına IP tabanlı rate limit eklendi.
- Uygulama içi limiter tek süreç içindir; Vercel çoklu instance için ek WAF/KV rate limit savunma katmanı olarak önerilir.

### Güvenlik header'ları
- CSP, HSTS, frame-ancestors/X-Frame-Options, Referrer-Policy, Permissions-Policy, nosniff ve opener/resource policy eklendi.
- Stripe ve OpenStreetMap için gerekli allowlist korunarak ödeme/takip işlevleri bozulmadı.

### Analytics
- Ham IP saklama kaldırıldı.
- Günlük salt/HMAC pseudonymization veya IP'siz çalışma, rate limit ve body limiti eklendi.

## Stripe ve fiyat güvenliği

- Payment prepare ve order create, ürün/extra/içecek/Pfand/kampanya/kupon/teslimat/bahşiş toplamını DB kataloğundan yeniden kuruyor.
- İstemciden gelen toplam ve fiyatlar güvenilir kabul edilmiyor.
- Bilinmeyen ürün/extra veya fiyat uyuşmazlığı Stripe açılmadan reddediliyor.
- Emergency Telegram fallback yalnızca sunucu DB erişilemezliğini doğruladığında ve sıkı rate limit altında çalışıyor.

## Testler

Başarılı:
- `npm run security:test`
- Security regression tests
- Session/API authorization tests
- TV login policy tests
- Driver password/session tests
- DB order-pricing manipulation tests
- Tam proje üzerinde `tsc --noEmit`
- Next.js webpack compile, type validation ve static page generation

Sandbox sınırlaması:
- Son `next build`, tüm sayfaları ürettikten sonra build-trace toplama aşamasında sandbox süresi içinde kapanmadı.
- Sandbox DNS'i son audit çağrısında `registry.npmjs.org` için `EAI_AGAIN` verdi. Daha önce aynı lockfile için audit 0 bulgu göstermiştir.
- Teslimat PowerShell'leri gerçek `C:\Web\burger` ve `C:\Web\burger-github` ortamlarında Prisma generate, audit ve tam production build'i zorunlu kılar; başarısızsa kurulum veya push durur.

## Kod dışında zorunlu kalan işler

Bunlar otomatik olarak yapılamaz ve canlıya geçmeden önce kullanıcı/Vercel/DB tarafında uygulanmalıdır:
- Eski admin/TV/driver PIN ve parolalarını değiştirme
- SESSION_SECRET ve print/cron/bootstrap tokenlerini döndürme
- Eski Git geçmişinde secret varsa GitHub geçmiş temizliği
- Vercel Environment Variables güncelleme ve redeploy
- Windows Firewall'da print-proxy inbound erişimini engelleme

## Kapsam dışı performans/bakım işleri

Aşağıdakiler güvenlik açığı kapatma paketinin dışında bırakıldı:
- Büyük PNG/video dosyalarının WebP/AVIF/WebM optimizasyonu
- Çok büyük TV/checkout/admin component'lerinin modüllere ayrılması
- Dosya sistemi fallback snapshot'ının KV/Blob'a taşınması

Bu işler güvenlik kapanışından sonra ayrı ve kontrollü performans/refactor aşaması olarak yapılmalıdır.
