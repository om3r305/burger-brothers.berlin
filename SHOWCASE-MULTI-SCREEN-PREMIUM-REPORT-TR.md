# Burger Brothers Showcase — Çoklu Ekran ve Premium Sahneler

## Eklenen yapı

- Bağımsız ekran yayınları: `main`, `brand`, `menu`, `announcement`
- Ekran adresleri: `/showcase/main`, `/showcase/brand`, `/showcase/menu`, `/showcase/announcement`
- Her ekran için ayrı taslak ve yayın anahtarı
- Ortak Cloudinary medya kütüphanesi
- Ekrana özel tarayıcı önbelleği

## Yeni sahneler

- Hava durumu
- Google yorumları
- Google yorum QR kodu
- Kampanya geri sayımı
- Bestseller / en çok sipariş edilenler
- Özel gün duyurusu
- Sosyal medya videosu

## Canlı veriler

- Hava durumu Berlin-Tegel koordinatlarıyla Open-Meteo üzerinden alınır.
- Bestseller verileri iptal edilmemiş son 30 günlük siparişlerden hesaplanır.
- Google yorumları admin onayından geçmeden yayınlanmaz.
- Google yorum QR bağlantısı sahne ayarından değiştirilebilir.

## Google Business bağlantısı

Vercel ortam değişkenleri olarak aşağıdaki değerler gerekir:

- `GOOGLE_BUSINESS_ACCESS_TOKEN`
- `GOOGLE_BUSINESS_ACCOUNT_ID`
- `GOOGLE_BUSINESS_LOCATION_ID`

Bu bilgiler ZIP içine eklenmemiştir. Access token süresi dolduğunda yenilenmesi gerekir. Kalıcı OAuth yenileme akışı sonraki aşamada eklenebilir.

## Güvenlik

- `.env`, token, secret ve API anahtarı pakete alınmadı.
- Yorumlar varsayılan olarak onaysız gelir.
- Minimum yıldız filtresi sahne bazında ayarlanabilir.
- Mevcut `/dashboard` dosyasına dokunulmadı.

## Test

`node tools/showcase-platform-expansion-tests.cjs` başarılı geçti.

Tam production build, teslimattaki PowerShell scripti tarafından `C:\Web\burger` üzerinde çalıştırılır.
