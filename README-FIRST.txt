BURGER BROTHERS — GIT DIFF CHECK FIX V1.2

Ekrandaki gercek hata:
prisma/schema.prisma:702: new blank line at EOF

LF -> CRLF satirlari yalniz Git uyarisidir ve hata degildir.

Bu paket:
- Bir onceki yarida kalan GitHub klonunu guvenli sekilde kabul eder.
- Yalniz bu bildirim calismasina ait degisikliklere izin verir.
- schema.prisma dahil degisen metin dosyalarindaki satir sonu bosluklarini temizler.
- Dosya sonunda tam bir adet newline birakir.
- qr-scanner kurulumunu kontrol eder.
- Typecheck ve production build calistirir.
- git diff --check kontrolunu tekrar yapar.
- EVET onayindan sonra commit ve push yapar.
- git init calistirmaz.
- .env ve secret dosyalarini kopyalamaz.

Calistirilacak dosya:
FIX-GIT-DIFF-CHECK-AND-PUSH-V1.2.bat
