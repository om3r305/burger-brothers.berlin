// prisma/seed.cjs
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding…");

  // TENANT
  const tenant = await prisma.tenant.upsert({
    where: { slug: "burger-brothers" },
    update: {},
    create: { name: "Burger Brothers Berlin", slug: "burger-brothers" },
  });

  // SETTINGS (örnek saatler vs.)
  await prisma.settings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      data: {
        hours: {
          avgPickupMinutes: 10,
          avgDeliveryMinutes: 35,
          newGraceMinutes: 5,
          timezone: "Europe/Berlin",
        },
        contact: { phone: "+49 30 1234567", address: "Berlin" },
      },
    },
  });

  // KATEGORİLER
  const cats = [
    { name: "Burger", slug: "burger" },
    { name: "Extras", slug: "extras" },
    { name: "Drinks", slug: "drinks" },
    { name: "Sauces", slug: "sauces" },
  ];
  for (const c of cats) {
    await prisma.category.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: c.slug } },
      update: {},
      create: { tenantId: tenant.id, name: c.name, slug: c.slug },
    });
  }

  // ÖRNEK ÜRÜN
  const burgerCat = await prisma.category.findFirst({
    where: { tenantId: tenant.id, slug: "burger" },
  });
  if (burgerCat) {
    await prisma.product.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: "classic-burger" } },
      update: {},
      create: {
        tenantId: tenant.id,
        categoryId: burgerCat.id,
        name: "Classic Burger",
        slug: "classic-burger",
        desc: "Saftiger Beef Burger mit Käse & Sauce",
        imageUrl: "/burger/classic.jpg",
        prices: { create: { tenantId: tenant.id, amount: 9.9 } },
      },
    });
  }

  console.log("✅ Seed bitti!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
