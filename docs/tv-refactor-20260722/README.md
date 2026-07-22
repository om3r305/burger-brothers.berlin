# Burger Brothers Berlin — TV Güvenli Refactor

Tarih: 22.07.2026

## Amaç

`app/tv/page.tsx` içindeki sipariş, ses, ETA, ayar, Brian, yazdırma,
ürün yönetimi ve görünüm sorumluluklarını mevcut davranışı bozmadan
ayrı hook ve component katmanlarına taşımak.

## Sonuç

- `app/tv/page.tsx`: 4.662 satırdan **796 satıra** indirildi.
- TVPage içindeki `useState`: 21 seviyesinden **4 UI state grubuna** indirildi.
- TV refactor kapsamındaki `any` kullanımı: **0**.
- Native `alert()` ve `confirm()` kaldırıldı.
- ETA için sipariş bazlı mutation kilidi eklendi.
- Eski polling cevaplarının yeni state'i ezmesini engelleyen sequence guard eklendi.
- `styled-jsx` TV CSS'i `app/tv/tv.css` dosyasına taşındı.
- TV error boundary stack trace'i kullanıcı ekranına yazmıyor.

## Yeni hook yapısı

- `use-tv-orders.ts`: sipariş fetch, merge, günlük filtre, polling, ETA ve timer cache
- `use-tv-sound.ts`: ses preload, yeni sipariş algılama, alarm ve cleanup
- `use-tv-settings.ts`: remote/local settings ve timezone
- `use-tv-brian.ts`: Brian yükleme, gate ve öğrenme
- `use-tv-print.ts`: print-proxy
- `use-tv-clock.ts`: tek merkezi saat
- `use-tv-products.ts`: TV ürün kapatma/açma
- `use-tv-pause.ts`: Lieferung/Abholung pause
- `use-tv-feedback.ts`: toast ve özel onay penceresi

## Korunan işleyiş

- Yeni sipariş kabul overlay'i
- Lieferung / Abholung farklı sesleri
- Dört saniyelik kabul alarmı
- Planned siparişlerde yalnız ileri saat ayarlama
- ETA +5 / -5
- Otomatik kabul ve yazdırma
- Manuel yazdırma ve PDF açma
- TV status geçişleri
- Fahrer entfernen
- Stornieren
- Günlük sipariş filtresi
- Ürün bugün/kalıcı kapatma
- Pause
- Brian route learning
- Ödeme rozetleri
- Fiyat, indirim ve toplam gösterimi
- TV PIN ve API yetkilendirmesi

## Bilerek değiştirilmedi

- Sipariş API sözleşmeleri
- Prisma schema ve migration
- Ödeme sistemi
- Stripe iade yöntemi
- Fiyatlama, kampanya, kupon ve Pfand
- Driver/track endpointleri
- Admin settings şeması
- Brian aktivasyon değerleri

## Stornieren

Bu teslimat, mevcut karara uygun olarak siparişi iptal eder.
Online ödeme iadesi otomatik yapılmaz; Stripe Dashboard üzerinden
kontrol edilip manuel yapılması gerektiği onay penceresinde açıkça gösterilir.

## Kurulum

ZIP içeriğini klasör yapısını koruyarak doğrudan:

```text
C:\Web\burger
```

üzerine çıkarın.

Ardından `PUSH-TV-REFACTOR-TO-GITHUB.ps1` dosyasını
`C:\Web\burger` içinden çalıştırın.

## Zorunlu manuel kontroller

1. Yeni Lieferung siparişi — ses, kabul ve otomatik baskı
2. Yeni Abholung siparişi — pickup sesi
3. Planned sipariş — saat yalnız ileri alınabilmeli
4. ETA +5 / -5 — hızlı çift tıklama ikinci isteği başlatmamalı
5. Status: preparing → ready/out_for_delivery → done
6. Fahrer entfernen
7. Manuel Drucken ve PDF öffnen
8. Stornieren — özel onay modalı ve hata toast'ı
9. Lieferung/Abholung pause
10. Artikel: öffnen / heute schließen / dauerhaft schließen
11. TV sayfası yenileme ve 5 saniyelik polling
12. Brian LED ve route learn

## Güvenlik

Pakette `.env`, secret, token, DB bağlantısı, `node_modules`, `.next`,
log veya veritabanı dosyası bulunmaz.
