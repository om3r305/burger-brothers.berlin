# Burger Brothers Berlin — Driver Tracking + UI Fix

## Düzeltilen 1: `order_not_assigned_to_driver`

Sunucu güvenlik kontrolü doğru çalışıyordu. Sorun client tarafındaydı:

- Driver ekranındaki `mine` listesi driver adı eşleşmesiyle de siparişi benim
  siparişim kabul edebiliyordu.
- GPS tracker bu sipariş için hemen başlayabiliyordu.
- Tracking API ise güvenli biçimde driver session subject ile DB içindeki
  gerçek `driver.id` değerini birebir karşılaştırıyordu.
- Ayrıca eski bir tracking isteği, sipariş pasif olduktan sonra sonuçlanırsa
  hata mesajını yeniden ekrana yazabiliyordu.

Yeni davranış:

- GPS yalnız `driver.id` mevcut driver session ID ile birebir eşleşirse başlar.
- Sipariş status değeri `out_for_delivery` olmalıdır.
- Geçici atama yayılımı için sınırlı sessiz retry uygulanır:
  800 ms, 1800 ms, 3500 ms.
- İlk 18 saniyedeki geçici atama hatası şoföre kırmızı teknik hata olarak
  gösterilmez.
- Uzun süren durumda teknik kod yerine anlaşılır sarı uyarı gösterilir.
- Pasif hale gelen veya değişen siparişe ait eski async istek sonucu yok sayılır.
- Sunucu güvenliği gevşetilmemiştir; başka şoförün siparişine tracking hâlâ
  kesin olarak reddedilir.

## Düzeltilen 2: Neu / Meine sekmeleri

- Aktif sekme daha güçlü arka plan, çift border/ring, glow ve alt işaret kullanır.
- Pasif sekme daha soluk ve koyu görünür.
- `aria-pressed` eklendi.
- Hangi sekmenin açık olduğu mobil ekranda netleşti.

## Düzeltilen 3: Fertig butonu

- Siyah yazı kaldırıldı.
- Koyu emerald gradient + beyaz yazı kullanılır.
- Disabled durumda da yazı okunabilir kalır.
- Butonun onClick, busy ve finish işleyişi değiştirilmedi.

## Dokunulmayan alanlar

- Prisma schema ve migration
- Sipariş claim/status API
- Tracking API güvenlik doğrulaması
- Driver cookie/session
- DB kayıtları
- TV, ödeme ve müşteri tracking ekranı
- Harita seçimi ve rota sistemi
