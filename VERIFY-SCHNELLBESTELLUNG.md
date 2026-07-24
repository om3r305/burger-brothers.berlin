# Schnellbestellung doğrulama

## Otomatik kontroller

```powershell
npm ci
npx prisma generate
npm run typecheck
npm run schnell:test
npm run security:test
npm run build
```

## QR ekranı kontrolü

1. Admin oturumuyla `/admin/schnellbestellung` sayfasını açın.
2. Sistem kapalıyken `/schnellbestellung/access-display` ekranında sonsuz boş kutu yerine “Schnellbestellung ist noch nicht aktiviert” mesajının göründüğünü doğrulayın.
3. **Sistem aktif** ve **Barzahlung aktif** seçeneklerini açıp kaydedin.
4. `SESSION_SECRET`, `NEXTAUTH_SECRET` veya `AUTH_SECRET` değerlerinden en az birinin bulunduğunu doğrulayın.
5. QR ekranında **Erneut versuchen** butonuna basın.
6. QR kodun görünür olduğunu ve yaklaşık her 60 saniyede güvenli şekilde yenilendiğini doğrulayın.
7. Localhost kullanılıyorsa ekranda telefon testi uyarısının göründüğünü doğrulayın.
8. Preview/live HTTPS domaininde QR'ı telefonla okutun ve GPS doğrulamasını tamamlayın.

## Sipariş kontrolü

Dükkân içinde ürün ekleyip cash siparişi gönderin. TV'de `VOR ORT` ve büyük müşteri numarası; fişte müşteri numarası, `SALONBESTELLUNG` ve `BAR OFFEN` görülmelidir.

## Beklenen güvenli hata durumları

- Sistem kapalı: QR üretilmez, açıklayıcı mesaj gösterilir.
- Sistem duraklatılmış: QR üretilmez, duraklatma mesajı gösterilir.
- Session secret eksik: QR üretilmez, yapılandırma mesajı gösterilir.
- API/DB geçici sorun: boş QR kutusu yerine tekrar deneme ekranı gösterilir.

## V1.2 admin kayıt kontrolü

1. Geçerli admin oturumuyla `/admin/schnellbestellung` sayfasını açın.
2. **Sistem aktif** ve **Barzahlung aktif** seçeneklerini değiştirin.
3. **Ayarları kaydet** butonuna basın.
4. Network/terminal çıktısında `PUT /api/admin/schnellbestellung 200` görülmelidir.
5. Sayfayı yenilediğinizde kaydedilen seçenekler korunmalıdır.
6. Ardından `/schnellbestellung/access-display` ekranı QR üretebilmelidir.

## V1.3 TV ses ve typecheck kontrolü

1. `npm run typecheck` komutunun `hooks/tv/use-tv-sound.ts` veya `lib/tv/domain.ts` için hata vermeden tamamlandığını doğrulayın.
2. Yeni bir Schnellbestellung siparişi oluşturun.
3. Siparişin TV'de `VOR ORT` etiketiyle göründüğünü ve yeni sipariş sesinin çaldığını doğrulayın.
4. Aynı anda delivery, pickup ve dine-in siparişleri gelirse ses kuyruğunun her türü sırayla işlediğini doğrulayın.
5. Ayrı salon ses dosyası henüz eklenmediği için dine-in siparişinin mevcut pickup sesini kullandığını doğrulayın.
