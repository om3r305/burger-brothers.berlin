# Schnellbestellung Complete V2 – Doğrulama

## Otomatik doğrulamalar
Bu teslim hazırlanırken aşağıdaki kontroller geçti:

- Schnellbestellung regression tests: OK
- TV refactor regression tests: OK
- Order pricing tests: OK
- Canonical pricing regression tests: OK
- Checkout safety regression tests: OK
- Değiştirilen 23 TypeScript/TSX dosyasında isolated syntax transpile: OK

Bu çalışma ortamında proje dependency klasörü bulunmadığı için tam `typecheck`, tüm `security:test` zinciri ve Next production build burada çalıştırılamadı. Teslimdeki GitHub PowerShell scripti gerçek `C:\Web\burger-github` çalışma alanında Prisma generate, typecheck, Schnellbestellung testleri, tüm security testleri ve production build başarılı olmadan commit/push oluşturmaz.

## Manuel kabul testi

1. `/admin/schnellbestellung` açın.
2. Sistem, Barzahlung, TV, ses ve otomatik fiş seçeneklerini kontrol edin.
3. QR modunu `Statik baskı QR` seçip ayarları kaydedin.
4. QR ekranını açın; PNG/SVG indirme ve yazdırmayı test edin.
5. Telefonla QR okuyup GPS doğrulamasından geçin.
6. Menü kategori sırasını kontrol edin.
7. Burger kartlarında içerik ve alerjen kodlarını; ürün penceresinde ayrıntılı alerjen açıklamalarını kontrol edin.
8. Soßen altında temel Ketchup/Mayo ürünlerinin görünmediğini, özel mayo soslarının görünmeye devam ettiğini kontrol edin.
9. Ürün ekleyip `Bestellung abschließen` seçin; `Bestellung abschließen?` onayı gelmeden sipariş gönderilmemeli.
10. Sipariş sonrası büyük günlük numarayı ve `Bestellung beenden` butonunu kontrol edin.
11. TV kabul ekranında `VOR ORT`, büyük numara ve sipariş saatini kontrol edin; ETA/dakika seçimi görünmemeli.
12. TV kartında In Vorbereitung → Fertig → Ausgegeben akışını test edin; Unterwegs seçeneği olmamalı.
13. TV sidebar'da Schnellbestellung sesini kapat/aç ve test et.
14. TV sidebar'da Schnellbestellung pause aç; yeni müşteri siparişinin bloke edildiğini kontrol et.
15. Admin'den kategori veya ürün kampanyası oluşturun; menü fiyatı ile sipariş toplamının aynı olduğunu doğrulayın.
16. Statik QR'ı yenileyin; eski QR reddedilmeli, yeni indirilen QR çalışmalı.
17. Dinamik moda geçin; QR'ın süreli yenilendiğini kontrol edin.
18. Normal Menü, Abholung, Lieferung, Stripe, Split Center, TV normal siparişleri, driver ve print akışlarına regression testi uygulayın.

## GitHub scriptinin zorunlu kapıları
- Repo clean kontrolü
- Doğru origin ve main branch kontrolü
- Fast-forward-only sync
- Backup
- Secret scan
- Prisma generate
- `npm run typecheck`
- `npm run schnell:test`
- `npm run security:test`
- `npm run build`
- `git diff --cached --check`
- Yalnız bu teslim dosyalarının stage/commit/push edilmesi
