# Burger Brothers Berlin – Driver Safe Refactor

## Amaç

`app/driver/page.tsx` içindeki sipariş yenileme, driver oturumu, rota,
GPS, teslimat tamamlama, hata bildirimi ve UI sorumlulukları ayrıldı.
Müşteri siparişi, DB, TV, ödeme ve tracking API sözleşmeleri değiştirilmedi.

## Yeni yapı

### Hooks

- `use-driver-auth.ts`: güvenli driver kimliği, login/logout ve remember davranışı
- `use-driver-orders.ts`: polling, focus/visibility refresh, claim, release,
  finish, optimistic update ve rollback
- `use-driver-settings.ts`: remote/local settings yaşam döngüsü
- `use-driver-route.ts`: rota seçimi ve çok duraklı Google Maps
- `use-pull-to-refresh.ts`: dokunmatik yenileme
- `use-driver-feedback.ts`: toast ve özel confirm akışı
- `use-driver-clock.ts`: tek merkezli zaman güncellemesi

### Components

Login, header, istatistik, pending kartı, sipariş detay kartı, zaman rozeti,
rota paneli, toast, confirm modalı ve pull indicator ayrı component'lere
taşındı.

### Domain

`lib/driver/domain.ts` API cevaplarını `unknown` kabul eder, kontrollü olarak
normalize eder ve component'lere tipli `DriverOrder` verir.

## Güvenlik

- Driver client kimliğinde yalnız `id` ve `name` tutulur.
- API `password`, boş password alanı, role veya başka alan döndürse bile
  localStorage'a yazılmaz.
- Native `alert()` ve `window.confirm()` kaldırıldı.
- Error boundary raw error mesajı veya stack göstermiyor.
- GPS tracker siparişleri ikinci kez poll etmiyor.
- GPS watcher yalnız aktif teslimat varken çalışıyor; inactive/unmount
  durumunda `clearWatch` ve tracking closeout uygulanıyor.
- Stale polling cevabının yeni state'i ezmesi sequence guard ile engellendi.
- Finish başarısız olursa immutable önceki sipariş geri yükleniyor.

## Driver settings

Aşağıdaki değerler Settings API/DB JSON yapısından okunur:

```json
{
  "driver": {
    "routePlzPriority": ["13403", "13405", "13505"],
    "storeOrigin": "Burger Brothers Berlin, Berlin Tegel",
    "refreshSeconds": 6.5,
    "activeUnknownGraceHours": 6
  }
}
```

Ayar yoksa mevcut Burger Brothers Tegel davranışını koruyan fallback değerler
kullanılır.

## Korunan işleyiş

- Login/logout ve remember
- Sipariş polling, focus ve visibility refresh
- Pull-to-refresh
- Tekli/toplu claim
- Planlı sipariş uyarısı
- Claim yarış güvenliği
- Meine/Neu listeleri
- Tek/çok duraklı rota
- iOS/Android/PWA Maps davranışı
- Telefon araması
- Lieferhinweis, içecek ve ödeme rozetleri
- GPS canlı takip
- Fahrer entfernen
- Lieferung abgeschlossen
- Optimistic rollback
- Gün sonu adet, ciro ve bahşiş
- TV ve tracking refresh eventleri

## Kurulum

Paketi klasör yapısını koruyarak `C:\Web\burger` üzerine çıkarın.
Ardından `PUSH-DRIVER-REFACTOR-TO-GITHUB.ps1` dosyasını doğrudan
`C:\Web\burger` içinden çalıştırın.
