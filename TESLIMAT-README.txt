BURGER BROTHERS - TAM PROJE TESLIMATI
=====================================

Bu ZIP uygulamanin calismasi ve GitHub/Vercel'e yuklenmesi icin gereken tam
kaynak kodu, public medya dosyalarini, Prisma semasini, migration'lari, seed
dosyasini, testleri ve yazdirma araci kaynaklarini icerir.

1) MEVCUT CANLI AYARLARI KORU
-----------------------------
ZIP bilerek gercek .env/.env.local, sifre, PIN, token, sertifika, ozel anahtar,
veritabani ve musteri verisi icermez. Mevcut C:\Web\burger\.env.local dosyanizi
silmeden saklayin. Yeni kurulum klasorune kendi mevcut .env.local dosyanizi geri
koyun. .env.example sadece degisken adlarini gosteren sablondur.

Production icin en az su degerler tanimli olmalidir:
- DATABASE_URL
- SESSION_SECRET (en az 32 karakter)
- ADMIN_USER ve ADMIN_PASS
- TV_PIN
- CRON_SECRET
- STRIPE_SECRET_KEY ve STRIPE_WEBHOOK_SECRET (online odeme kullaniliyorsa)
- PRINT_AGENT_TOKEN / PRINT_PROXY_TOKEN (yazdirma kullaniliyorsa)
- UPSTASH_REDIS_REST_URL ve UPSTASH_REDIS_REST_TOKEN (Vercel rate limit ve fallback)

2) TEMIZ KURULUM VE DOGRULAMA
-----------------------------
PowerShell'i bu klasorde acin ve calistirin:

  npm ci
  npx prisma migrate deploy
  npm run verify

Bos bir test veritabani icin ornek urun seed'i istege bagli olarak:

  npx prisma db seed

Canli ve dolu veritabaninda seed komutunu gereksiz yere calistirmayin.

3) CALISTIRMA
-------------
Gelisim:

  npm run dev

Production build ve calistirma:

  npm run build
  npm run start

Yazdirma kullaniliyorsa print-agent/config.example.json dosyasini config.json,
print-proxy/.env.example dosyasini .env olarak kopyalayip kendi yazici IP ve
token degerlerinizi girin. Bu iki yerel ayar dosyasini GitHub'a eklemeyin.

4) GITHUB'A GONDERME
--------------------
Bu klasor mevcut Git repository'nizin icindeyse:

  git status
  git add -A
  git commit -m "fix: complete security and operational hardening"
  git push

.gitignore; .env, anahtar, sertifika, DB, root data, local print ayarlari,
node_modules ve .next dosyalarini disarida tutar. GitHub'a gondermeden once
"git status" ciktisinda bu tur dosyalarin bulunmadigini kontrol edin.

5) BU TESLIMATTA DOGRULANANLAR
------------------------------
- Siparis/odeme kurallari sunucuda dogrulaniyor.
- Surucu sadece uygun veya kendisine atanmis siparisleri goruyor.
- Iptal ve otomatik Stripe iadesi yalnizca admin tarafindan tetikleniyor.
- Takip oturumlari surucu kimligine ve musteri takip token'ina bagli.
- Genel ve tekil kupon kullanimlari transaction icinde kaydediliyor.
- Odeme taslaklari operasyon siparisi olarak gorunmuyor.
- Baskidaki harita QR'i yerel uretiliyor; adres ucuncu tarafa gonderilmiyor.
- Production cron, CRON_SECRET yoksa kapali kaliyor.
- Guvenlik testleri, TypeScript, Prisma, npm audit ve production build kontrolu
  teslimat olusturulmadan once calistirildi.
