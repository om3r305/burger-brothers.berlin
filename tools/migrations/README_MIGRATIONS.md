# Migrations
- `lib/server/db.ts` uses a key-value table when SQLite is enabled.
- You can export JSON data into SQLite by writing keys like `orders.json`, `settings.json`, `tracking.json` into `kv(k,v)`.
- Example (pseudo):
  - INSERT INTO kv (k,v) VALUES ('orders.json', json('...'));
  - Same for 'settings.json' and 'tracking.json'.
- For Postgres/Prisma, create tables mirroring these keys and adapt `db.ts` accordingly.
