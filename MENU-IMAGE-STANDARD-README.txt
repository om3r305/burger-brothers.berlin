BURGER BROTHERS — MENU IMAGE STANDARD v1.0

Bu teslimat yalnızca iki dosyayı değiştirir:
1. app/menu/page.tsx
2. components/menu/ProductCard.tsx

Değişiklik kapsamı:
- Yalnızca /menu ürün görselleri etkilenir.
- Sepet, fiyat, kampanya, alerjen, ürün sıralaması, modal ve API işleyişine dokunulmaz.
- Şeffaf 1536x1024 ürün görsellerinin alfa alanı tarayıcıda okunur.
- Burgerin gerçek görünen sınırı otomatik bulunur.
- Menü kartında bütün burgerler ortak görünür alan ve alt hizaya getirilir.
- Gri görsel zemini, sayfanın temasına uyumlu sıcak koyu zemine çevrilir.
- Showcase ve TV bileşenlerine hiçbir değişiklik yapılmaz.
- Görsel dosyalarının kendisi değiştirilmez.

UYGULAMA
1. ZIP'i bir klasöre çıkar.
2. APPLY-MENU-IMAGE-STANDARD.ps1 dosyasına sağ tıkla veya PowerShell'de çalıştır:

   powershell -ExecutionPolicy Bypass -File .\APPLY-MENU-IMAGE-STANDARD.ps1

Script önce iki mevcut dosyayı yedekler, sonra yeni dosyaları kopyalar,
typecheck ve production build çalıştırır. Test başarısız olursa eski dosyaları geri yükler.

GITHUB
Lokal testten sonra GITHUB-PUSH-MENU-IMAGE-STANDARD.ps1 dosyasını kullanabilirsin.
Bu script git init çalıştırmaz ve yalnızca iki değişen dosyayı commit eder.
