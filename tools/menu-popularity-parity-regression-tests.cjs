const fs = require("fs");
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
