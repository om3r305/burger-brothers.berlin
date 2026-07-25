# Burger Brothers Schnellbestellung — Polish V4

Bu teslimat yalnız Schnellbestellung menüsü, ilgili admin ayarları, telefon
hazır ekranı ve TV sekme davranışını günceller.

## Düzeltilen ürün adları

Getränke ve Extras grup başlığı ürün adına tekrar eklenmez.

Örnekler:

```text
Coca Cola Fanta 0,33l
→ Fanta 0,33l

Coca Cola Sprite 0,33l
→ Sprite 0,33l

Fries Chili Cheese Fries
→ Chili Cheese Fries

Jarritos (Mexico) Jarritos Mango 0,37l
→ Jarritos Mango 0,37l
```

Bu temizlik yalnız Schnellbestellung kataloğunda yapılır. Normal internet
menüsündeki ürün kayıtları değiştirilmez.

## Angebot ürünlerinin sırası

Aktif kampanyası bulunan ürünler kendi kategorilerinde otomatik olarak ilk
sıraya alınır. Bir kategoride birden fazla Angebot varsa kendi aralarında
alfabetik sıralanır.

Angebot rozeti daha dikkat çekici gösterilir:

```text
🔥 ANGEBOT 🔥
```

Rozette gradient, parlama ve hafif pulse efekti bulunur. Özel rozet metni
girildiyse aynı emojili tasarım korunur.

## Admin kategori görünürlüğü

Schnellbestellung admin paneline ayrı kategori kontrolleri eklendi:

- Burger
- Vegan / Vegetarisch
- Extras
- Soßen
- Hot Dogs
- Getränke
- Donuts
- Bubble Tea

Kapatılan kategori yalnız hızlı menüden gizlenir. Normal internet menüsü
etkilenmez. En az bir kategori açık kalmalıdır.

Eski ayarlarda `visibleCategories` boşsa geriye dönük uyumluluk için bütün
kategoriler açık kabul edilir.

## TV Fertig davranışı

Schnellbestellung siparişinde `Fertig` basıldığında:

- Kart anında yerel olarak `ready` durumuna geçer.
- Neu sekmesinden anında çıkar.
- TV otomatik olarak `Fertig` sekmesine geçer.
- Server kaydı arka planda tamamlanır.
- Kayıt başarısız olursa liste server'dan tekrar yüklenerek düzeltilir.

Dine-in `ready` siparişleri artık hem üst sekme sayısında hem de sol özet
panelinde `Fertig` kabul edilir.

## Telefon hazır sesi ve titreşim

TV'de `Fertig` yapıldığında müşterinin açık bekleme ekranında:

- Dört tur güçlü ses dizisi çalınır.
- Ses Web Audio compressor üzerinden mümkün olan yüksek seviyede üretilir.
- Destekleyen Android tarayıcılarda uzun titreşim deseni çalışır.
- iPhone Safari titreşim API'sini desteklemediği için iPhone'da ses ve görsel
  uyarı çalışır; titreşim işletim sistemi sınırına bağlıdır.

Telefonun fiziksel sessiz modu veya düşük medya sesi web sayfası tarafından
zorla değiştirilemez.

## İlk açılış ve görsel hızı

- Katalog cihaz cache anahtarı V4'e yükseltildi; eski isim/sıra cache'i silinir.
- Sağlam katalog aynı cihazda 30 dakika performans cache'i olarak tutulur.
- Server katalog memory cache'i 30 saniyedir.
- İlk kategorinin ilk 12 görseli önceden ısıtılır.
- Sıradaki kategorinin ilk görselleri arka planda hazırlanır.
- Kategoriye dokunulduğunda görseller daha tıklama tamamlanmadan yüklenmeye başlar.
- İlk sekiz görsel eager, ilk altı görsel yüksek önceliklidir.
- Kırık görselde tarayıcı soru işareti yerine temiz Burger Brothers placeholder
  gösterilir.

## DB

Prisma şeması değişmedi. Migration gerekmez.

## Kurulum

1. Çalışan geliştirme terminalini `Ctrl + C` ile durdurun.
2. ZIP içeriğini doğrudan `C:\Web\burger` klasörünün üzerine çıkarın.
3. Dosyaların değiştirilmesini onaylayın.
4. Yerel kontrol:

```powershell
cd C:\Web\burger
npm.cmd run dev
```

5. Kontrol tamamlanınca:

```text
RUN-SCHNELLBESTELLUNG-POLISH-V4-GITHUB-PUSH.bat
```

dosyasına çift tıklayın.

PowerShell içeriğini terminale yapıştırmayın; dosya olarak çalıştırın.
