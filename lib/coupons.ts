// lib/coupons.ts
// Gutschein çekirdeği (localStorage). Benzersiz kod üretimi, planlı dağıtım, ödül kuralları,
// aşırı-kupon koruması (aynı müşteri), BOGO desteği, doğrulama ve limit kontrolleri.

export type CouponType = "fixed" | "percent" | "free_item" | "bogo";

export type BogoRule = {
  matchBy: "sku" | "name" | "category";
  matchValue: string;            // örn. "big-daddy" ya da "Burger"
  buyQty: number;                // örn. 2
  freeQty: number;               // örn. 1
  maxFreePerOrder?: number;      // üst sınır (ops.)
};

export type CouponDef = {
  id: string;
  code: string;                  // temel/prefix kod
  title?: string;
  type: CouponType;
  value: number;                 // fixed: €; percent: 0-100; free_item/bogo: bilgilendirme
  minCartTotal?: number;         // MIN sepet (gönderdiğin cartTotal’a göre kıyaslanır)
  maxUses?: number;              // GLOBAL toplam kullanım limiti
  perCustomerLimit?: number;     // müşteri başına kullanım limiti
  validFrom?: number;
  validUntil?: number;
  createdAt: number;
  meta?: {
    uniquePerIssue?: boolean;    // her verilişte tekil kod
    freeItemName?: string;
    aboutText?: string;

    // Otomatik ödüller:
    awardRules?: AwardRule[];

    // Anti-abuse (issue aşaması):
    singlePerCustomer?: boolean; // aynı telefona en fazla 1 issue
    issueCapPerWeek?: number;    // 7 günde en fazla N issue
    issueCooldownDays?: number;  // min X gün arayla issue

    // BOGO
    bogo?: BogoRule;
  };
};

export type IssuedCoupon = {
  id: string;
  couponId: string;
  code: string;                  // tekil kod
  assignedToPhone?: string | null;
  assignedToEmail?: string | null;
  issuedAt: number;
  expiresAt?: number | null;
  used?: boolean;
  usedAt?: number | null;
  source?: string;               // "manual" | "bulk_schedule" | "auto:nth_order:10" ...
  note?: string;                 // "scheduled" → zamanı gelince "available"/"cancelled"
};

export type CartItemForCoupon = {
  sku?: string;
  name?: string;
  category?: string;
  qty: number;
  unitPrice: number;
};

const LS_COUPONS = "bb_coupons_v1";
const LS_ISSUED  = "bb_issued_coupons_v1";

/* ───────── utils ───────── */
const rid = () => `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

// Gutscheincode için tek noktadan sağlam normalizasyon
const normalizeCode = (s?: string|null) =>
  String(s ?? "")
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "") // tüm boşluk & zero-width
    .trim()
    .toLowerCase();

function load<T>(k: string): T | null {
  try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function save(k: string, v: any) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

/* ───────── benzersiz kod üretimi ───────── */
export function generateCode(length = 8, prefix = "") {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const make = () => Array.from({length}).map(()=> chars[Math.floor(Math.random()*chars.length)]).join("");
  const existing = new Set<string>();
  getAllCoupons().forEach(c => existing.add(normalizeCode(c.code)));
  getAllIssued().forEach(i => existing.add(normalizeCode(i.code)));
  for (let i=0;i<4000;i++){
    const code = (prefix? `${prefix}-`: "") + make();
    if (!existing.has(normalizeCode(code))) return code;
  }
  return (prefix? `${prefix}-`: "") + make() + "-" + Math.random().toString(36).slice(2,4).toUpperCase();
}

/* ───────── CRUD (tanımlar) ───────── */
export function getAllCoupons(): CouponDef[] {
  const arr = load<CouponDef[]>(LS_COUPONS) || [];
  return Array.isArray(arr) ? arr : [];
}
export function saveCoupon(def: CouponDef){
  // emniyet: kaydederken de temizle
  def.code = (def.code || "").toString().toUpperCase().trim()
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "");
  const all = getAllCoupons();
  const i = all.findIndex(x=>x.id===def.id);
  if (i>=0) all[i]=def; else all.unshift(def);
  save(LS_COUPONS, all);
  return def;
}
export function createCoupon(partial: Partial<CouponDef>): CouponDef {
  const now = Date.now();
  const baseCode = partial.code ? partial.code.toString().toUpperCase().trim() : generateCode(8, "BB");
  const tidyCode = baseCode.replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "");
  const def: CouponDef = {
    id: partial.id || rid(),
    code: tidyCode,
    title: partial.title || "",
    type: partial.type || "fixed",
    value: typeof partial.value==="number" ? partial.value : 0,
    minCartTotal: partial.minCartTotal,
    maxUses: partial.maxUses,
    perCustomerLimit: partial.perCustomerLimit,
    validFrom: partial.validFrom ?? now,
    validUntil: partial.validUntil,
    createdAt: now,
    meta: partial.meta || {},
  };
  return saveCoupon(def);
}
export function deleteCoupon(id: string){
  const left = getAllCoupons().filter(c=>c.id!==id);
  save(LS_COUPONS, left);
}

/* ───────── Issued ───────── */
export function getAllIssued(): IssuedCoupon[] {
  const arr = load<IssuedCoupon[]>(LS_ISSUED) || [];
  return Array.isArray(arr) ? arr : [];
}
export function persistIssued(list: IssuedCoupon[]) { save(LS_ISSUED, list); }

function pickIssueCodeFromDef(def: CouponDef){
  if (def.meta?.uniquePerIssue){
    const prefix = (def.code.split("-")[0] || "CP").slice(0,6).toUpperCase();
    return generateCode(8, prefix);
  }
  return def.code;
}

/* ───────── Issue anti-abuse yardımcıları ───────── */
function issuesOfPhoneForCoupon(phone: string | null | undefined, couponId: string){
  if (!phone) return [];
  return getAllIssued().filter(i => i.couponId===couponId && i.assignedToPhone===phone);
}
function canIssueToPhone(def: CouponDef, phone?: string | null, now = Date.now()){
  if (!phone) return true; // telefona atanmayacaksa kısıtları atla
  const meta = def.meta || {};
  const history = issuesOfPhoneForCoupon(phone, def.id).sort((a,b)=> (b.issuedAt||0)-(a.issuedAt||0));

  if (meta.singlePerCustomer && history.length > 0) return false;

  if (typeof meta.issueCapPerWeek === "number"){
    const weekAgo = now - 7*24*3600*1000;
    const lastWeekCount = history.filter(h => h.issuedAt >= weekAgo).length;
    if (lastWeekCount >= meta.issueCapPerWeek) return false;
  }

  if (typeof meta.issueCooldownDays === "number" && history.length > 0){
    const last = history[0];
    const gap = now - (last.issuedAt || 0);
    if (gap < meta.issueCooldownDays * 24*3600*1000) return false;
  }

  return true;
}

/* ───────── Kullanım istatistikleri ───────── */
export function getUsageStats(couponId: string, phone?: string|null) {
  const issued = getAllIssued().filter(i => i.couponId === couponId);
  const globalUsed = issued.filter(i => i.used).length;
  const globalTotal = issued.length;

  let customerUsed = 0;
  if (phone) {
    customerUsed = issued.filter(i => i.assignedToPhone === phone && i.used).length;
  }
  return { globalUsed, globalTotal, customerUsed };
}

/* ───────── Gutschein verme ───────── */
export function issueCoupon(opts: {
  couponId: string;
  phone?: string | null;
  email?: string | null;
  expiresAfterDays?: number | null;
  source?: string;
  note?: string;
}): IssuedCoupon | null {
  const def = getAllCoupons().find(c=>c.id===opts.couponId);
  if (!def) return null;
  const now = Date.now();

  if (!canIssueToPhone(def, opts.phone, now)) return null;

  const issued: IssuedCoupon = {
    id: rid(),
    couponId: def.id,
    code: pickIssueCodeFromDef(def),
    assignedToPhone: opts.phone ?? null,
    assignedToEmail: opts.email ?? null,
    issuedAt: now,
    expiresAt: opts.expiresAfterDays!=null ? now + opts.expiresAfterDays*24*3600*1000 : (def.validUntil ?? null),
    used: false,
    usedAt: null,
    source: opts.source || "manual",
    note: opts.note
  };
  const all = getAllIssued();
  all.unshift(issued);
  persistIssued(all);
  return issued;
}

export function issueBulkToPhones(couponId: string, phones: string[], expiresAfterDays?: number | null, source?: string){
  const out: IssuedCoupon[] = [];
  for (const p of phones){
    const it = issueCoupon({ couponId, phone: p, expiresAfterDays, source });
    if (it) out.push(it);
  }
  return out;
}

/* ───────── Planlı dağıtım ───────── */
export function scheduleBulkDistribution(params: {
  couponId: string;
  count: number;
  days: number;
  phonePool?: string[];
  expiresAfterDays?: number | null;
  source?: string;
}){
  const def = getAllCoupons().find(c=>c.id===params.couponId);
  if (!def) return 0;
  const now = Date.now();
  const all = getAllIssued();
  for (let i=0;i<params.count;i++){
    const day = Math.floor(Math.random()*Math.max(1, params.days));
    const withinDayMs = Math.floor(Math.random()*24*3600*1000);
    const ts = now + day*24*3600*1000 + withinDayMs;
    const phone = params.phonePool?.length ? params.phonePool[i % params.phonePool.length] : null;

    const expiresAt = params.expiresAfterDays!=null ? ts + params.expiresAfterDays*24*3600*1000 : (def.validUntil ?? null);
    const item: IssuedCoupon = {
      id: rid(),
      couponId: def.id,
      code: pickIssueCodeFromDef(def),
      assignedToPhone: phone ?? null,
      assignedToEmail: null,
      issuedAt: ts,
      expiresAt,
      used: false,
      usedAt: null,
      source: params.source || "bulk_schedule",
      note: "scheduled",
    };
    all.unshift(item);
  }
  persistIssued(all);
  return params.count;
}

export function deliverScheduled(now = Date.now()){
  const defs = getAllCoupons();
  const all = getAllIssued();
  let changed = false;
  for (const it of all){
    if (it.note === "scheduled" && it.issuedAt <= now){
      const def = defs.find(d=>d.id===it.couponId);
      if (def && !canIssueToPhone(def, it.assignedToPhone, now)) {
        it.note = "cancelled";
        changed = true;
        continue;
      }
      it.note = "available";
      changed = true;
    }
  }
  if (changed) persistIssued(all);
  return changed;
}

/* ───────── Açıklama metni ───────── */
export function describeCoupon(def: CouponDef, issued?: IssuedCoupon){
  const lines: string[] = [];
  if (def.type==="fixed") lines.push(`€${def.value.toFixed(2)} indirim kuponu`);
  else if (def.type==="percent") lines.push(`Sepette %${def.value} indirim kuponu`);
  else if (def.type==="bogo") {
    const b = def.meta?.bogo;
    if (b) {
      lines.push(`BOGO: ${b.buyQty} al ${b.freeQty} bedava`);
      lines.push(`• Kapsam: ${b.matchBy} = ${b.matchValue}`);
      if (b.maxFreePerOrder) lines.push(`• Sipariş başı en fazla ${b.maxFreePerOrder} bedava`);
    } else lines.push("BOGO kuponu");
  } else {
    lines.push(`Hediye: ${def.meta?.freeItemName || "ürün"}`);
  }

  if (def.minCartTotal) lines.push(`• Yalnızca ${def.minCartTotal.toFixed(2)}€ ve üzeri sepetlerde geçerli`);
  if (def.validUntil) lines.push(`• Son kullanma: ${new Date(def.validUntil).toLocaleDateString()}`);
  if (def.perCustomerLimit) lines.push(`• Müşteri başına en fazla ${def.perCustomerLimit} kullanım`);
  if (def.meta?.aboutText) lines.push(`• ${def.meta.aboutText}`);
  if (issued?.assignedToPhone) lines.push(`• Sadece ${issued.assignedToPhone} için atanmış`);
  return lines.join("\n");
}

/* ───────── Uygulanabilirlik / indirimi hesapla ───────── */
export type CheckResult =
  | { ok: true; discountAmount: number; message: string }
  | { ok: false; reason: string; message: string };

// Dahili: limit kontrolleri
function checkHardLimits(def: CouponDef, phone?: string|null): { ok: true } | { ok:false; reason:string; message:string } {
  const { globalUsed, customerUsed } = getUsageStats(def.id, phone);

  if (typeof def.maxUses === "number" && globalUsed >= def.maxUses) {
    return { ok:false, reason:"max_uses_reached", message:"Gutscheinun global kullanım limiti dolmuş." };
  }
  if (typeof def.perCustomerLimit === "number" && phone && customerUsed >= def.perCustomerLimit) {
    return { ok:false, reason:"per_customer_limit", message:"Bu numara için kupon kullanım limiti dolmuş." };
  }
  return { ok: true };
}

export function canApply(params: {
  def: CouponDef;
  issued?: IssuedCoupon | null;
  cartTotal: number;               // **net** tutar kıyaslaması için (sen Checkout’ta after-discount veriyorsun)
  cartItems?: CartItemForCoupon[]; // BOGO için gerekli
  customerPhone?: string | null;
  now?: number;
}): CheckResult {
  const { def, issued, cartTotal } = params;
  const now = params.now ?? Date.now();

  // tarih
  if (def.validFrom && now < def.validFrom) return { ok:false, reason:"not_started", message:"Gutschein henüz aktif değil." };
  if (def.validUntil && now > def.validUntil) return { ok:false, reason:"expired", message:"Gutscheinun süresi dolmuş." };

  // issued bağlamı
  if (issued){
    if (issued.used) return { ok:false, reason:"used", message:"Bu kupon zaten kullanılmış." };
    if (issued.expiresAt && now > issued.expiresAt) return { ok:false, reason:"issued_expired", message:"Bu kuponun süresi dolmuş." };
    if (issued.assignedToPhone && params.customerPhone && issued.assignedToPhone !== params.customerPhone){
      return { ok:false, reason:"assigned_other", message:"Bu kupon farklı bir numaraya atanmış." };
    }
    if (issued.note === "scheduled" && issued.issuedAt > now){
      return { ok:false, reason:"not_available_yet", message:"Gutschein henüz dağıtıma açılmadı." };
    }
  }

  // limitler (global & müşteri)
  const limitChk = checkHardLimits(def, params.customerPhone ?? null);
  if (limitChk.ok === false) return limitChk;

  // minimum sepet – gönderilen cartTotal değeri üzerinden (senin “net ödenecek” mantığın)
  if (def.minCartTotal && cartTotal < def.minCartTotal){
    return { ok:false, reason:"below_min", message:`Minimum sepet tutarı ${def.minCartTotal.toFixed(2)}€.` };
  }

  // indirim hesapları
  if (def.type==="fixed"){
    const d = round2(Math.min(def.value, Math.max(0, cartTotal)));
    return { ok:true, discountAmount: d, message:`€${def.value.toFixed(2)} indirim uygulandı.` };
  }
  if (def.type==="percent"){
    const d = round2(Math.max(0, cartTotal) * (def.value/100));
    return { ok:true, discountAmount: d, message:`%${def.value} indirim uygulandı.` };
  }
  if (def.type==="free_item"){
    return { ok:true, discountAmount: 0, message:`Hediye: ${def.meta?.freeItemName || "ürün"} eklendi.` };
  }
  if (def.type==="bogo"){
    const rule = def.meta?.bogo;
    const items = params.cartItems || [];
    if (!rule) return { ok:false, reason:"bogo_misconfig", message:"BOGO kuralı tanımlı değil." };
    const match = (it: CartItemForCoupon) => {
      const val = (rule.matchBy==="sku" ? (it.sku||"")
                : rule.matchBy==="category" ? (it.category||"")
                : (it.name||"")).toLowerCase();
      return val.includes((rule.matchValue||"").toLowerCase());
    };
    const pool = items
      .filter(match)
      .flatMap(it => Array.from({length: it.qty}).map(()=> it.unitPrice))
      .sort((a,b)=>a-b);
    if (!pool.length) return { ok:false, reason:"bogo_no_match", message:"BOGO ürünü sepette yok." };

    let free = 0;
    if (rule.buyQty > 0){
      const group = rule.buyQty;
      const possibleFree = Math.floor(pool.length / group) * rule.freeQty;
      free = rule.maxFreePerOrder ? Math.min(possibleFree, rule.maxFreePerOrder) : possibleFree;
    }
    const discount = round2(pool.slice(0, free).reduce((a,b)=>a+b, 0));
    if (discount<=0) return { ok:false, reason:"bogo_zero", message:"BOGO indirimi hesaplanamadı." };
    return { ok:true, discountAmount: discount, message:`BOGO: ${rule.buyQty} al ${rule.freeQty} bedava uygulandı.` };
  }

  return { ok:false, reason:"unknown_type", message:"Gutschein tipi desteklenmiyor." };
}

/* ───────── Redeem (kullan) ───────── */
export function findIssuedByCode(code: string){
  const list = getAllIssued();
  const want = normalizeCode(code);
  return list.find(i=> normalizeCode(i.code)===want) || null;
}

export function redeemIssued(id: string, customerPhone?: string, now = Date.now()){
  const list = getAllIssued();
  const idx = list.findIndex(i=>i.id===id);
  if (idx===-1) return { ok:false, reason:"not_found" as const };
  const it = list[idx];

  if (it.used) return { ok:false, reason:"already_used" as const };
  if (it.expiresAt && it.expiresAt < now) return { ok:false, reason:"expired" as const };
  if (it.assignedToPhone && customerPhone && it.assignedToPhone !== customerPhone){
    return { ok:false, reason:"assigned_to_other" as const };
  }

  // def bazlı limitlere tekrar bak (güvenlik)
  const def = getAllCoupons().find(c => c.id === it.couponId);
  if (def) {
    const limitChk = checkHardLimits(def, customerPhone ?? it.assignedToPhone ?? null);
    if (limitChk.ok === false) return limitChk;
  }

  it.used = true; it.usedAt = now; list[idx]=it; persistIssued(list);
  return { ok:true, item: it };
}

/* ───────── Otomatik ödül kuralları ───────── */
export type AwardRule =
  | { kind:"nth_order"; n:number; couponId:string; expiresDays?:number }
  | { kind:"spent_total"; minTotal:number; couponId:string; expiresDays?:number }
  | { kind:"manual"; couponId:string };

export function evaluateAutoAwardsForCustomer(params: {
  phone?: string | null;
  email?: string | null;
  customerName?: string | null;
  lastOrderTs?: number;
  orderTotal?: number;
  orders?: any[];
}){
  const phone = params.phone ?? null;
  const orders = params.orders || [];
  const orderTotal = params.orderTotal || 0;
  const now = Date.now();
  const results: IssuedCoupon[] = [];
  for (const c of getAllCoupons()){
    const rules = (c.meta?.awardRules || []) as AwardRule[];
    for (const r of rules){
      if (phone && !canIssueToPhone(c, phone, now)) continue;

      if (r.kind==="nth_order"){
        const count = orders.filter(o=>{
          if (phone && o?.customer?.phone) return o.customer.phone===phone;
          if (!phone && params.customerName && o?.customer?.name) return o.customer.name===params.customerName;
          return false;
        }).length;
        if (count>0 && count % r.n === 0){
          const iss = issueCoupon({ couponId: r.couponId, phone, expiresAfterDays: r.expiresDays, source:`auto:nth_order:${r.n}` });
          if (iss) results.push(iss);
        }
      } else if (r.kind==="spent_total"){
        if (orderTotal >= r.minTotal){
          const iss = issueCoupon({ couponId: r.couponId, phone, expiresAfterDays: r.expiresDays, source:`auto:spent_total:${r.minTotal}` });
          if (iss) results.push(iss);
        }
      }
    }
  }
  return results;
}

/* ───────── Export / Import ───────── */
export function exportAll(){
  return JSON.stringify({ coupons: getAllCoupons(), issued: getAllIssued() }, null, 2);
}
export function importAll(txt: string){
  try {
    const obj = JSON.parse(txt);
    if (Array.isArray(obj?.coupons)) save(LS_COUPONS, obj.coupons);
    if (Array.isArray(obj?.issued)) save(LS_ISSUED, obj.issued);
    return true;
  } catch { return false; }
}
