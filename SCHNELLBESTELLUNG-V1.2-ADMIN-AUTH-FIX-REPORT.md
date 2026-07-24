# Schnellbestellung V1.2 — Admin kayıt 401 düzeltmesi

## Belirti

- `GET /api/admin/schnellbestellung` başarılı (`200`)
- `PUT /api/admin/schnellbestellung` başarısız (`401`)
- Admin ekranında “Ayarlar kaydedilemedi.” mesajı
- Sistem etkinleştirilemediği için QR endpointi `503 disabled` döndürüyordu

## Kök neden

`requireMutationRole` ikinci parametre olarak rol dizisi bekler. Yeni route içinde
yanlışlıkla düz metin `"admin"` gönderilmişti. JavaScript çalışma zamanında bu
metin karakter karakter dolaşıldığı için geçerli admin oturumu bulunamıyor ve
mutation isteği `401` ile reddediliyordu.

## Düzeltme

```ts
requireMutationRole(req, ["admin"])
```

Route okunabilir biçimde formatlandı ve regression testine bu sözleşmeyi koruyan
iki kontrol eklendi.

## DB / migration

Prisma şeması veya DB migration değiştirilmedi.
