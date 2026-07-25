# Burger Brothers Schnellbestellung — Push + Sipariş Limiti V6

Bu teslimat iki önemli konuyu birlikte kapatır:

1. Android Chrome arka plan / kilit ekranı bildirimi
2. Tamamlanmış siparişlerden sonra yeni sipariş verebilme

## Android arka plan bildirimi

Müşteri `Ja, bestellen` düğmesine bastığında, Android Chrome destekliyorsa
bildirim iznini kendi sistem penceresiyle ister. Uygulama içinde ek bir modal
veya ek buton gösterilmez.

İzin verilirse:

- Service Worker kaydedilir.
- Siparişe mevcut tarayıcı push aboneliği bağlanır.
- TV'de her gerçek `Fertig` geçişinde server push servisini uyandırır.
- Chrome arka planda, başka uygulama açıkken veya telefon kilitliyken sistem
  bildirimi gösterebilir.
- Bildirim varsayılan sistem sesi, uzun titreşim deseni ve kalıcı görünüm ister.
- Bildirime dokunulduğunda ilgili sipariş ekranı açılır.

Aynı sipariş:

```text
Fertig → bildirim
Neu / In Vorbereitung
Fertig → yeni ready-event → yeniden bildirim
```

Aynı ready-event push servisi tarafından tekrarlanırsa Service Worker olay
kimliğini saklar ve mükerrer bildirim göstermez.

## Açık sayfa uyarısı

Mevcut güçlü HTML Audio + Web Audio + ekran uyarısı korunur. Service Worker
sayfa açıksa ayrıca sayfaya mesaj gönderir. Böylece polling gecikmeden hazır
ekranı ve ses çalıştırılmaya çalışılır.

## iPhone sınırı

Normal Safari sekmesi ana ekrana eklenmeden arka planda veya kilit ekranında
Web Push alamaz. Bu paket iPhone'da sayfa açıkken güçlü sesli ve görsel uyarıyı
korur. Apple'ın normal Safari sekmesi sınırı kodla aşılamaz.

Telefonun fiziksel sessiz modu, Rahatsız Etmeyin ayarı veya bildirim kanalının
kullanıcı tarafından sessize alınması web sitesi tarafından zorla değiştirilemez.

## Sipariş limiti düzeltmesi

Cihaz limiti artık yalnız aktif siparişleri sayar:

```text
new
preparing
ready
```

Şunlar aktif limite dahil değildir:

```text
done / ausgegeben
completed
issued
cancelled
```

Böylece ilk sipariş tamamlandıktan sonra müşteri QR kodunu yeniden okutup yeni
sipariş verebilir. Aynı anda açık çok sayıda sipariş oluşturma koruması devam
eder.

## Push güvenliği

- Push aboneliği yalnız geçerli Schnellbestellung HttpOnly oturumuyla kaydedilir.
- Siparişin `deviceId` değeri oturumla uyuşmazsa abonelik reddedilir.
- Mutasyonlarda trusted-origin ve rate-limit kontrolleri çalışır.
- Abonelik yalnız ilgili siparişin `meta` JSON alanında tutulur.
- Prisma migration yoktur.
- VAPID private key ZIP'e, GitHub'a veya kaynak koda yazılmaz.
- Push aboneliği 404/410 dönerse süresi geçmiş abonelik siparişten temizlenir.

## VAPID kurulumu

Önce ZIP'i `C:\Web\burger` üzerine çıkarın. Ardından:

```text
GENERATE-SCHNELL-PUSH-VAPID-KEYS.bat
```

dosyasına çift tıklayın. Terminal üç değer gösterecek:

```text
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:...
```

Vercel projesinde Environment Variables bölümüne üçünü de Production,
Preview ve Development için ekleyin.

`VAPID_SUBJECT` için işletmeye ait gerçek bir e-posta kullanın. Örnek:

```text
mailto:info@burger-brothers.berlin
```

`VAPID_PRIVATE_KEY` gizlidir. Ekran görüntüsü paylaşmayın, GitHub'a eklemeyin
ve herhangi bir `.env` dosyasını ZIP'e koymayın.

Env değerlerini ekledikten sonra Vercel'de yeniden deploy gerekir.

## Admin

Admin > Schnellbestellung içinde yeni anahtar:

```text
Android arka plan bildirimi aktif
```

Kapalıysa push config ve abonelik kaydı devre dışı kalır. Açık sayfadaki mevcut
hazır sesi ayrı `Telefon hazır uyarısı aktif` anahtarıyla çalışmaya devam eder.

## Kurulum

1. Dev terminalini `Ctrl + C` ile durdurun.
2. ZIP içeriğini doğrudan `C:\Web\burger` üzerine çıkarın.
3. Dosyaların değiştirilmesini onaylayın.
4. Yerel kontrol:

```powershell
cd C:\Web\burger
npm.cmd run dev
```

5. GitHub gönderimi için yalnız şunu çalıştırın:

```text
RUN-SCHNELL-PUSH-AND-ORDER-LIMIT-V6-GITHUB-PUSH.bat
```

Eski GitHub BAT dosyalarını kullanmayın.
