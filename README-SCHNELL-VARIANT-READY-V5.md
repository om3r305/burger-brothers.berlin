# Burger Brothers Schnellbestellung — Variant + Ready Alert V5

Bu hedefli teslimat iki konuyu birlikte düzeltir.

## 1. Getränke ve Extras isimleri

Hızlı menü kartında artık SKU veya grup adı kullanılmaz. Admin panelinde
`Varianten` alanına ne yazıldıysa müşteri kartında o metin birebir gösterilir.

Örnek:

```text
Grup SKU: Coca-Cola
Grup Name: Coca Cola
Varianten: Fanta 0,33l

Schnellbestellung kartı: Fanta 0,33l
```

Variant metni `Coca-Cola Zero 0,33l` ise aynen o şekilde görünür. Sistem artık
grup adını variant metninden otomatik silmeye çalışmaz.

Eski katalog cihaz cache'inin kullanılmaması için cache anahtarı V5'e
yükseltilmiştir.

## 2. Fertig uyarısının tekrar çalışması

Her gerçek `non-ready → ready` geçişi benzersiz bir ready-event üretir.

```text
Fertig → telefon uyarısı
Neu / In Vorbereitung
Tekrar Fertig → telefon yeniden uyarır
```

Polling aynı ready-event'i birkaç kez görse bile ikinci kez ses çıkarmaz. Yeni
Fertig geçişi yeni event kimliği aldığı için ses, görsel hazır ekranı ve
desteklenen cihazlarda titreşim yeniden çalışır.

## Ses güçlendirmesi

Sipariş onayındaki kullanıcı dokunuşunda iki ses kanalı hazırlanır:

- HTML media: `/sounds/dine-in.wav`
- Web Audio: yüksek gain + compressor ile oluşturulan uyarı dizisi

Hazır durumunda:

- Media sesi altı kez tekrarlanır.
- Web Audio uyarısı altı tur çalınır.
- Desteklenen Android tarayıcılarda uzun titreşim deseni çalışır.

### iPhone sessiz modu hakkında teknik sınır

iPhone'un fiziksel sessiz anahtarını veya cihazın medya ses seviyesini bir web
sayfası zorla değiştiremez. Paket HTML media ve Web Audio kanallarını birlikte
kullanarak mümkün olan en güçlü best-effort uyarıyı sağlar; fakat Apple'ın
sessiz modunu aşmak yüzde yüz garanti edilemez. Sayfanın açık kalması ve medya
sesinin kullanıcı tarafından kapatılmamış olması gerekir.

## DB

Prisma şeması değişmedi. Migration gerekmez. Ready event bilgisi mevcut Order
`meta` JSON alanında saklanır.

## Kurulum

1. Dev terminalini `Ctrl + C` ile durdurun.
2. ZIP içeriğini doğrudan `C:\Web\burger` üzerine çıkarın.
3. Dosyaların üzerine yazılmasını onaylayın.
4. Yerel kontrol:

```powershell
cd C:\Web\burger
npm.cmd run dev
```

5. GitHub gönderimi için:

```text
RUN-SCHNELL-VARIANT-READY-V5-GITHUB-PUSH.bat
```

Dosyasına çift tıklayın. Eski BAT dosyalarını kullanmayın.
