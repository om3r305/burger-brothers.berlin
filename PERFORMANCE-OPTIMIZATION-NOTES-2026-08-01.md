# Burger Brothers Berlin — Operational Polling Optimization

Tarih: 2026-08-01

Bu sürüm sipariş, ödeme, TV, driver, showcase ve yazdırma işleyişini değiştirmeden sürekli açık operasyon ekranlarının arka plan sorgularını azaltır.

## Korunan kritik davranışlar

- TV aktif sipariş varken 5 saniyelik sipariş yenilemesini korur.
- Print Agent varsayılan 5 saniyelik iş kontrolünü korur.
- Driver aktif sipariş/teslimat varken mevcut hızlı yenileme ayarını korur.
- Admin push mesajı geldiğinde bildirim zili anında yenilenir.
- Showcase admin yayın sinyali geldiğinde anında tam yenileme yapar.
- Gizli sekmeler tekrar görünür olduğunda anında yenilenir.

## Azaltılan gereksiz çağrılar

- TV boşken sipariş kontrolü: 5 sn → 8 sn.
- Driver giriş yapılmamışken sipariş polling'i: tamamen kapalı.
- Driver giriş yapılmış fakat aktif iş yokken: en az 15 sn.
- TV Brian arka plan modeli: 30 sn → 5 dk; görünmeyen sekmede ağ isteği yok.
- Admin attention fallback: 30 sn → 2 dk; push/focus/panel açılışı anlık kalır.
- Showcase canlı etkinlik kontrolü: 4 sn → 10 sn.
- Showcase ana snapshot: değişiklik sonrası kısa süre hızlı, kararlı durumda en az 30 sn.
- TV/driver/showcase üzerinde global SettingsSync ve ProductsSync tekrarları kaldırıldı; ilgili ekranların kendi kanonik veri hook'ları kullanılmaya devam eder.
- Dashboard boşken 10 sn, aktif sipariş varken 5 sn; gizli sekmede ağ isteği yok.
- Eksik `/favicon.ico` eklendi; favicon kaynaklı `/_not-found` çağrısı engellendi.

## Ek yük

- Yeni npm paketi veya servis eklenmedi.
- Yeni sürekli bağlantı, WebSocket veya Supabase Realtime kanalı eklenmedi.
- Veritabanı şeması ve migration değiştirilmedi.

## Yerel doğrulamalar

- Artifact security scan: PASS
- Hardening regression: PASS
- Operational polling regression: PASS
- Performance / DB pool regression: PASS
- TV refactor regression: PASS
- Driver refactor regression: PASS
- Showcase regression / hardening: PASS
- Değiştirilen TS/TSX dosyalarında TypeScript syntax transpile: PASS

Tam `npm ci`, typecheck ve production build çalışma ortamındaki özel npm registry'nin `zustand@4.5.2` paketini döndürmemesi nedeniyle burada tekrar koşturulamadı. GitHub CI internet erişimli ortamda bunları zorunlu olarak çalıştıracak şekilde güncellendi.
