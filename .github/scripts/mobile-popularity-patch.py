from pathlib import Path

page_path = Path("app/menu/page.tsx")
page = page_path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global page
    count = page.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one {label}, found {count}")
    page = page.replace(old, new, 1)


replace_once(
    "type FeatureFlags = {\n  donuts: boolean;\n  bubbleTea: boolean;\n  productAvailability: ProductAvailabilityMap;\n};",
    "type FeatureFlags = {\n  donuts: boolean;\n  bubbleTea: boolean;\n  productAvailability: ProductAvailabilityMap;\n};\n\ntype PopularityRankMap = Record<string, 1 | 2 | 3>;",
    "PopularityRankMap type marker",
)

marker = "function readProductsFromLS(): Product[] {"
loader = '''async function dbLoadPopularity(): Promise<PopularityRankMap> {
  try {
    const res = await fetch("/api/catalog/popularity", {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (!res.ok) throw new Error(`popularity_${res.status}`);

    const json = await res.json();
    const raw = json?.ranks && typeof json.ranks === "object" ? json.ranks : {};
    const out: PopularityRankMap = {};

    for (const [productId, rank] of Object.entries(raw)) {
      const numericRank = Number(rank);
      if (numericRank === 1 || numericRank === 2 || numericRank === 3) {
        out[String(productId)] = numericRank;
      }
    }

    return out;
  } catch {
    return {};
  }
}

'''
if page.count(marker) != 1:
    raise SystemExit("Could not find unique readProductsFromLS marker")
page = page.replace(marker, loader + marker, 1)

replace_once(
    "  const [products, setProducts] = useState<Product[]>([]);\n  const [campaigns, setCampaigns] = useState<Campaign[]>([]);",
    "  const [products, setProducts] = useState<Product[]>([]);\n  const [campaigns, setCampaigns] = useState<Campaign[]>([]);\n  const [popularityRanks, setPopularityRanks] = useState<PopularityRankMap>({});",
    "popularity state marker",
)

replace_once(
    "    const [catalog, flags] = await Promise.all([\n      dbLoadCatalog(),\n      dbLoadFeatureFlags(),\n    ]);",
    "    const [catalog, flags, ranks] = await Promise.all([\n      dbLoadCatalog(),\n      dbLoadFeatureFlags(),\n      dbLoadPopularity(),\n    ]);",
    "reload Promise.all marker",
)

replace_once(
    "    setProducts(catalog.products);\n    setCampaigns(catalog.campaigns);\n\n    if (flags) {",
    "    setProducts(catalog.products);\n    setCampaigns(catalog.campaigns);\n    setPopularityRanks(ranks);\n\n    if (flags) {",
    "popularity state update marker",
)

replace_once(
    '''        if (isBurgerOrVegan) {
          const badge = popularityBadgeFor(plike.id, baseListForTab);
          topSellerRank =
            badge === "gold"
              ? 1
              : badge === "silver"
                ? 2
                : badge === "bronze"
                  ? 3
                  : undefined;
        }''',
    '''        if (isBurgerOrVegan) {
          // DB aggregate is device-independent, so desktop and mobile share one rank.
          // The old localStorage calculation stays only as an offline fallback.
          topSellerRank = popularityRanks[plike.id];

          if (!topSellerRank) {
            const badge = popularityBadgeFor(plike.id, baseListForTab);
            topSellerRank =
              badge === "gold"
                ? 1
                : badge === "silver"
                  ? 2
                  : badge === "bronze"
                    ? 3
                    : undefined;
          }
        }''',
    "top seller rank marker",
)

replace_once(
    "    baseListForTab,\n    features.productAvailability,\n  ]);",
    "    baseListForTab,\n    features.productAvailability,\n    popularityRanks,\n  ]);",
    "list dependencies marker",
)

page_path.write_text(page, encoding="utf-8")

test_path = Path("tools/menu-popularity-parity-regression-tests.cjs")
test_path.write_text(
    '''const fs = require("fs");
const assert = require("assert");

const page = fs.readFileSync("app/menu/page.tsx", "utf8");
const route = fs.readFileSync("app/api/catalog/popularity/route.ts", "utf8");
const card = fs.readFileSync("components/menu/ProductCard.tsx", "utf8");

assert(page.includes('fetch("/api/catalog/popularity"'));
assert(page.includes('const [popularityRanks, setPopularityRanks] = useState<PopularityRankMap>({});'));
assert(page.includes('topSellerRank = popularityRanks[plike.id];'));
assert(page.includes('if (!topSellerRank) {'));
assert(page.includes('popularityBadgeFor(plike.id, baseListForTab)'));
assert(page.includes('topSellerRank={topSellerRank}'));

assert(route.includes('prisma.order.findMany'));
assert(route.includes('prisma.product.findMany'));
assert(route.includes('ranks[product.id] = (index + 1) as 1 | 2 | 3'));
assert(route.includes('cancelledAt'));
assert(!route.includes('customer: true'));
assert(!route.includes('select: { customer'));

assert(card.includes('function MedalBadgeImage'));
assert(card.includes('<MedalBadgeImage rank={topSellerRank} offsetTop={medalOffset} />'));

console.log("Menu desktop/mobile popularity parity regression tests: OK");
''',
    encoding="utf-8",
)
