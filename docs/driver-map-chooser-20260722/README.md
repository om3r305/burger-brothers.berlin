# Burger Brothers Berlin — Driver Karten-App Auswahl

## Yeni davranış

Driver ekranında ilk harita kullanımında cihaz tipine göre bir seçim paneli açılır.

### iPhone / iPad
- Apple Karten
- Google Maps

### Android
- Google Maps
- Andere Karten-App (tek teslimat için Android uygulama seçimi)

### Masaüstü
- Google Maps web önizlemesi

Seçilen uygulama cihazda şu anahtarla saklanır:

`bb_driver_map_preference_v1`

Tek siparişteki **Karte** düğmesi ve toplu rota aynı tercihi kullanır.

## Rota artık otomatik başlamaz

Google Maps URL'sinden `dir_action=navigate` kaldırıldı.
Android `google.navigation:` deep link ve zaman aşımı fallback zinciri kaldırıldı.

Harita yalnız rota önizlemesini açar. Şoför navigasyonu harita uygulamasında
kendi **Start / Git** düğmesiyle başlatır.

## Başlangıç noktası

Sabit restoran başlangıç adresi gönderilmez.
Google/Apple haritası, mümkün olduğunda cihazın güncel konumunu başlangıç
olarak kullanır.

## Çoklu rota

- Google Maps: `waypoints`
- Apple Karten: tekrarlanan `waypoint`

parametreleriyle seçilen teslimat sırası korunur.

Android'deki genel `geo:` bağlantısı birden fazla durak için standart bir
yapı sunmadığından **Andere Karten-App** seçeneği yalnız tek teslimatta
sunulur. Çoklu rota gerektiğinde Google Maps seçimi gösterilir.

## Harita tercihini değiştirme

Driver rota panelinde:

`Karten-App: <seçilen uygulama>`

düğmesine basılarak tercih değiştirilebilir.

## İşletim sistemi güvenlik uyarısı

Web/PWA kodu, iOS veya Android'in “harici uygulamayı aç” güvenlik uyarısını
zorla kapatamaz. Bu uyarı tarayıcı ve işletim sistemi tarafından yönetilir.
Bizim uygulama kendi seçim panelini yalnız ilk kullanımda gösterir ve seçimi
hatırlar.

## Dokunulmayan sistemler

- Prisma ve DB
- Sipariş create/list/status/claim API'leri
- Ödeme ve Stripe
- TV
- Tracking
- Driver GPS watcher
- Claim / finish / release
- PLZ rota sıralaması
