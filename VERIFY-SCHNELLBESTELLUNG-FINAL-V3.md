# VERIFY — Schnellbestellung Final V3

## Admin

- `Konum kontrolü aktif` kapalıyken QR doğrudan menüye gider.
- Aynı ayar açıldığında GPS otomatik doğrulanır.
- `Zum Mitnehmen seçimi aktif` çalışır.
- Son sipariş geçmişi ve telefon hazır uyarısı açılıp kapatılabilir.
- Turuncu ve kırmızı TV eşikleri değiştirilebilir.
- Mevcut statik/dinamik QR ve Schnellbestellung kampanyaları korunur.

## Menü

- Burger açıklaması ve alerjenleri görünür.
- Getränke ve Extras mevcut Setting grup kayıtlarından gelir.
- Grup adı tekrarı yalnız Schnellbestellung'da temizlenir.
- Sade Ketchup/Mayo görünmez.
- Katalog cache'den hızlı açılır; arka planda güncellenir.
- Client toplamı sipariş otoritesi değildir; server yeniden hesaplar.

## Sipariş

- Varsayılan sipariş burada yeme olarak kabul edilir.
- Checkbox işaretlenirse takeaway kaydedilir.
- Dinamik onay modalı doğru metni gösterir.
- Çift dokunma tek sipariş oluşturur.
- Geçmiş sipariş geri yüklenince güncel ürün/fiyat kullanılır.

## TV

- Kart `VOR ORT` görünür; Lieferung görünmez.
- Büyük müşteri numarası ve oluşturulma saati görünür.
- Yalnız paket siparişinde `ZUM MITNEHMEN` görünür.
- `Seit X Min.` gerçek created time üzerinden hesaplanır.
- Yeni/preparing kartı yeşil, turuncu ve kırmızı eşiklere uyar.
- Schnellbestellung kartında delivery ETA düğmeleri yoktur.
- Status akışı `Neu → In Vorbereitung → Fertig → Ausgegeben` olur.
- `Unterwegs` / `out_for_delivery` server tarafından reddedilir.

## Telefon hazır ekranı

- Başarı URL'sinde order ID bulunur.
- Status endpointi yalnız aynı cihazın siparişini gösterir.
- `Fertig` durumunda ekran değişir, ses ve desteklenen cihazda titreşim çalışır.
- Screen Wake Lock best-effort kullanılır.
- Yalnız `Seite schließen` butonu vardır.
- Ana sayfaya otomatik yönlendirme yoktur.

## Fiş

- Schnellbestellung müşteri numarası büyük basılır.
- Paket seçildiyse yalnız `ZUM MITNEHMEN` basılır.
- Paket değilse ekstra fulfillment satırı basılmaz.
- Güvenli order barkodu ve mevcut print-agent akışı korunur.

## Otomatik doğrulama

GitHub scripti commit öncesinde şunları çalıştırır:

```text
npx prisma generate
npm run typecheck
npm run schnell:test
npm run security:test
npm run build
git diff --cached --check
```

Herhangi bir aşama başarısız olursa commit oluşturmaz ve
`C:\Web\burger-github` dosyalarını yedekten geri yükler.
