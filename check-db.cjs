require("dotenv").config({ path: ".env.local" });

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const ping = await prisma.$queryRawUnsafe("SELECT 1 AS ok");
  console.log("DB OK:", ping);

  const tenant = await prisma.tenant.upsert({
    where: { slug: "burger-brothers" },
    update: { name: "Burger Brothers Berlin" },
    create: { slug: "burger-brothers", name: "Burger Brothers Berlin" },
    select: { id: true, slug: true, name: true },
  });

  console.log("TENANT OK:", tenant);
}

main()
  .catch((e) => {
    console.error("DB/TENANT FAIL");
    console.error("Code:", e.code);
    console.error("Message:", e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
