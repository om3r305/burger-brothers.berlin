# Postgres'e Geçiş – Hızlı Kurulum

1) `.env` dosyanıza ekleyin:
```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require"
DEFAULT_TENANT_SLUG="burger-brothers"
```
2) Bağımlılıklar:
```
npm i @prisma/client
npx prisma generate
npx prisma migrate deploy   # prod
# veya local:
# npx prisma migrate dev --name init_postgres
```
3) Seed (opsiyonel): Admin'den kaydettiğiniz ürünleri otomatik DB'ye yazmak için admin sayfasında **Kaydet** yapın.
4) API'ler:
- `GET /api/products` → { items: Product[] }
- `PUT /api/products` → { items: Product[], replace?: boolean } (deprecated; /catalog kullanın)
- `GET /api/catalog` → { products: Product[], campaigns: Campaign[] }
- `PUT /api/catalog` → { products, campaigns, replace }
- `GET /api/settings` → tüm key/value map
- `PUT /api/settings` → tüm key/value map (merge/upsert)

Artık müşteri tarafı **DB-first** yüklenir; LocalStorage yalnızca cache'tir.
