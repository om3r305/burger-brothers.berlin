Burger Brothers – Ürün/Varyant Bazlı Pfand + Sabit Menü Sırası

Değişen/yeni dosyalar:
- lib/menu-navigation.ts
- components/NavBar.tsx
- components/Header.tsx
- app/menu/page.tsx
- app/admin/page.tsx
- app/api/groups/route.ts
- app/drinks/page.tsx
- components/shared/VariantGroupCard.tsx
- lib/pfand.ts

Pfand:
- Grup bazlı Pfand kaldırıldı.
- Her içecek varyantında ayrı seçim vardır:
  Kein Pfand / 0,08 € / 0,15 € / 0,25 € / Eigener Betrag.
- İsim, grup, ambalaj veya kategori üzerinden otomatik tahmin yapılmaz.
- Değer yoksa Pfand kesin olarak 0 € olur.
- API varyant alanlarını saklar.
- Sepete varyantın pfandType/pfandAmount değeri taşınır.
- Mevcut checkout, kampanya, kupon, split pay, sipariş ve fiş hesapları
  lib/pfand.ts üzerinden aynı akışla devam eder.

Navigasyon:
- Tek merkezi kaynak lib/menu-navigation.ts.
- Sabit sıra:
  Burger, Vegan / Vegetarisch, Extras, Soßen, Hot Dogs,
  Getränke, Donuts, Bubble Tea.
- Aktif sekmenin ortalanma davranışı korunur; sıra route'a göre değişmez.

DB:
- Prisma migration gerekmez; bilgiler mevcut grup JSON varyantlarına yazılır.
