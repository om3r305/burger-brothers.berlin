
# DB Enablement (Prisma + Postgres)

1) Install deps
   npm i -D prisma
   npm i @prisma/client

2) .env
   DATABASE_URL="postgresql://user:pass@host:5432/dbname?schema=public"

3) Generate & migrate
   npx prisma generate
   npx prisma migrate dev -n init

4) Settings API
   GET /api/settings
   PUT /api/settings

5) Brian
   import { saveLearnToDB } from "@/app/api/brian/learn/db";
   import { writeBrianModelToDB } from "@/app/api/brian/export/db";
