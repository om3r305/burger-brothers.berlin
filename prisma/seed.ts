// prisma/seed.ts
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_SLUG =
  process.env.DEFAULT_TENANT_SLUG ||
  process.env.TENANT_SLUG ||
  "burger-brothers";

const TENANT_NAME =
  process.env.DEFAULT_TENANT_NAME ||
  process.env.TENANT_NAME ||
  "Burger Brothers Berlin";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

async function main() {
  console.log("🌱 Seed gestartet…");

  const tenant = await prisma.tenant.upsert({
    where: {
      slug: TENANT_SLUG,
    },
    update: {
      name: TENANT_NAME,
    },
    create: {
      slug: TENANT_SLUG,
      name: TENANT_NAME,
    },
  });

  await prisma.setting.upsert({
    where: {
      tenantId_key: {
        tenantId: tenant.id,
        key: "settings",
      },
    },
    update: {
      value: json({
        hours: {
          avgPickupMinutes: 10,
          avgDeliveryMinutes: 35,
          newGraceMinutes: 5,
          timezone: "Europe/Berlin",
        },
        contact: {
          phone: "+49 30 1234567",
          address: "Berlin Tegel",
        },
        validation: {
          phoneDigits: 11,
        },
      }),
    },
    create: {
      tenantId: tenant.id,
      key: "settings",
      value: json({
        hours: {
          avgPickupMinutes: 10,
          avgDeliveryMinutes: 35,
          newGraceMinutes: 5,
          timezone: "Europe/Berlin",
        },
        contact: {
          phone: "+49 30 1234567",
          address: "Berlin Tegel",
        },
        validation: {
          phoneDigits: 11,
        },
      }),
    },
  });

  await prisma.setting.upsert({
    where: {
      tenantId_key: {
        tenantId: tenant.id,
        key: "pause",
      },
    },
    update: {
      value: json({
        delivery: false,
        pickup: false,
      }),
    },
    create: {
      tenantId: tenant.id,
      key: "pause",
      value: json({
        delivery: false,
        pickup: false,
      }),
    },
  });

  const products = [
    {
      sku: "classic-burger",
      name: "Classic Burger",
      description: "Saftiger Beef Burger mit Käse und Sauce",
      imageUrl: "/burger/classic.jpg",
      category: "burger",
      price: 9.9,
      order: 1,
    },
    {
      sku: "cheese-burger",
      name: "Cheese Burger",
      description: "Beef Burger mit extra Käse",
      imageUrl: "/burger/cheese.jpg",
      category: "burger",
      price: 10.9,
      order: 2,
    },
    {
      sku: "pommes",
      name: "Pommes",
      description: "Knusprige Pommes",
      imageUrl: "/extras/pommes.jpg",
      category: "extras",
      price: 3.9,
      order: 1,
    },
    {
      sku: "coca-cola-033",
      name: "Coca-Cola 0,33l",
      description: "Erfrischungsgetränk",
      imageUrl: "/drinks/coca-cola.jpg",
      category: "drinks",
      price: 2.5,
      order: 1,
    },
    {
      sku: "bb-sauce",
      name: "Burger Brothers Sauce",
      description: "Hausgemachte Sauce",
      imageUrl: "/sauces/bb-sauce.jpg",
      category: "sauces",
      price: 1.0,
      order: 1,
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: {
        tenantId_sku: {
          tenantId: tenant.id,
          sku: product.sku,
        },
      },
      update: {
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        category: product.category,
        price: decimal(product.price),
        active: true,
        order: product.order,
      },
      create: {
        tenantId: tenant.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        category: product.category,
        price: decimal(product.price),
        active: true,
        order: product.order,
      },
    });
  }

  console.log("✅ Seed abgeschlossen.");
  console.log("Tenant:", tenant.slug);
  console.log("Produkte:", products.length);
}

main()
  .catch((error) => {
    console.error("❌ Seed fehlgeschlagen:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });