# Burger Brothers Schnellbestellung — Final V3

Bu teslimat, restoran içi hızlı sipariş akışını mümkün olan en az adımla
çalıştırmak için hazırlanmıştır.

## Hızlı müşteri akışı

Konum kontrolü admin panelinde kapalıysa:

```text
QR okut
→ güvenli kısa süreli oturum
→ doğrudan menü
```

Arada konum ekranı, izin mesajı veya onay düğmesi gösterilmez.

Konum kontrolü açıksa GPS kontrolü otomatik yapılır. Tarayıcı ilk kullanımda
kendi konum izin penceresini gösterebilir; ayrıca uygulama ekranı gösterilmez.

Katalog daha hızlı açılır:

- Ayrı session isteği yoktur.
- Son sağlam katalog aynı cihazda kısa süreli cache edilir.
- Server tarafında kısa süreli katalog cache'i kullanılır.
- İlk ürün görselleri öncelikli, devamı lazy-load edilir.
- Yüklenirken boş siyah ekran yerine skeleton gösterilir.

## Zum Mitnehmen

Sepette küçük `Zum Mitnehmen` checkbox'ı bulunur.

- İşaretli değil: sipariş restoranda yenir.
- İşaretli: sipariş paket hazırlanır.
- Onay penceresinin Almanca metni seçime göre otomatik değişir.
- TV'de yalnız paket siparişinde `ZUM MITNEHMEN` rozeti görünür.
- Fişte yalnız paket siparişinde `ZUM MITNEHMEN` yazılır.
- Normal siparişte `HIER ESSEN` gibi gereksiz bir satır basılmaz.

## TV zaman göstergesi

Schnellbestellung kartı gerçek sipariş oluşturulma saatine göre renk değiştirir:

- Yeni sipariş: yeşil
- Uyarı eşiği: turuncu
- Kritik eşik ve sonrası: giderek kırmızı
- Kritik süre uzarsa hafif pulse uyarısı

Kartta ayrıca `Seit X Min.` ve sipariş saati görünür.

Admin panelinden:

- TV zaman renkleri aktif/pasif
- Turuncu başlangıç dakikası
- Kırmızı başlangıç dakikası

ayarlanabilir.

## Telefon hazır uyarısı

Sipariş başarı ekranı açık kalır ve desteklenen cihazlarda Screen Wake Lock
kullanarak ekranın uykuya geçmesini önlemeye çalışır.

TV'de sipariş `Fertig` yapıldığında:

- Telefon ekranı hazır görünümüne döner.
- Büyük müşteri numarası gösterilir.
- İki kez sesli uyarı çalınır.
- Desteklenen cihazlarda titreşim çalışır.

Ana ekrana ekleme veya uygulama kurulumu istenmez. Bu canlı uyarı, sayfa açık
kaldığı sürece çalışır.

Başarı ekranında yalnız:

```text
Seite schließen
```

butonu vardır. `Neue Bestellung` veya ana sayfaya yönlendirme yoktur.

## Son siparişleri hatırlama

Aynı cihazdaki son siparişler yerel olarak hatırlanabilir.

- Adres, telefon veya kart bilgisi saklanmaz.
- Ürün ID, extra, not, adet ve paket seçimi tutulur.
- Geri yüklenirken mevcut katalog ve güncel fiyatlar kullanılır.
- Artık bulunmayan ürün veya extralar eklenmez.
- Saklama günü ve maksimum geçmiş sayısı admin panelinden ayarlanabilir.

## Menü isimleri

Yalnız Schnellbestellung ekranında tekrar eden grup ön ekleri kaldırılır:

```text
Bionade – Bionade Holunder 0,33l
→ Bionade Holunder 0,33l

Fries – Chili Cheese Fries
→ Chili Cheese Fries

Fries – Country Potatos
→ Country Potatos
```

Normal internet menüsündeki ürün adları değiştirilmez.

Masalarda bulunduğu için yalnız sade `Ketchup`, `Mayo` ve `Mayonnaise`
Schnellbestellung soslarından gizlenir. Chili-Mayo gibi özel soslar kalır.

## Güvenlik

GPS kapalı olsa da şu kontroller devam eder:

- Geçerli sabit veya dinamik QR
- İmzalı HttpOnly salon oturumu
- Oturum süresi
- Cihaz başına rate limit
- Idempotency ile çift sipariş koruması
- Ürün ve fiyatların server'da yeniden doğrulanması
- Admin pause ve acil oturum iptali
- Driver sisteminden tam ayrım
- Schnellbestellung siparişinin `out_for_delivery` durumuna geçememesi

## DB

Prisma şeması değiştirilmedi. Migration gerekmez. Mevcut `Order`, `Setting`,
`Product` ve grup ayarları kullanılır.

## Kurulum

1. Çalışan dev terminalini `Ctrl + C` ile durdurun.
2. ZIP içeriğini doğrudan `C:\Web\burger` üzerine çıkarın.
3. Dosyaların üzerine yazılmasına izin verin.
4. Yerel test:

```powershell
cd C:\Web\burger
npm.cmd run dev
```

5. Kontrol tamamlanınca:

```text
RUN-SCHNELLBESTELLUNG-FINAL-V3-GITHUB-PUSH.bat
```

dosyasına çift tıklayın.

PowerShell içeriğini terminale yapıştırmayın; dosya olarak çalıştırın.
