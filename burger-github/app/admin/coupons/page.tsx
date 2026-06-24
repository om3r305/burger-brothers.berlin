// app/admin/coupons/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as Coupons from "@/lib/coupons";

const fmtDT = (ts?: number | null) => (ts ? new Date(ts).toLocaleString() : "—");
const uuid = () => (typeof crypto !== "undefined" && (crypto as any).randomUUID ? crypto.randomUUID() : String(Math.random()));

type GUIRule = { id: string; kind: "nth_order" | "spent_total"; n?: number; minTotal?: number; expiresDays?: number };

export default function AdminCouponsPage() {
  // lists
  const [coupons, setCoupons] = useState<Coupons.CouponDef[]>([]);
  const [issued, setIssued] = useState<Coupons.IssuedCoupon[]>([]);
  const [filter, setFilter] = useState("");

  // create form
  const [title, setTitle] = useState("");
  const [type, setType] = useState<Coupons.CouponType>("fixed");
  const [value, setValue] = useState(5);
  const [minCart, setMinCart] = useState<number | "">("");
  const [validDays, setValidDays] = useState<number | "">(7);
  const [perCust, setPerCust] = useState<number | "">("");

  // meta
  const [uniquePerIssue, setUniquePerIssue] = useState(true);
  const [aboutText, setAboutText] = useState("");
  const [freeItemName, setFreeItemName] = useState("");

  // anti-abuse
  const [singlePerCustomer, setSinglePerCustomer] = useState(false);
  const [capPerWeek, setCapPerWeek] = useState<number | "">("");
  const [cooldownDays, setCooldownDays] = useState<number | "">("");

  // code prefix
  const [codePrefix, setCodePrefix] = useState("BB");

  // BOGO
  const [bogoMatchBy, setBogoMatchBy] = useState<"sku" | "name" | "category">("name");
  const [bogoMatchValue, setBogoMatchValue] = useState("");
  const [bogoBuy, setBogoBuy] = useState(2);
  const [bogoFree, setBogoFree] = useState(1);
  const [bogoMaxFree, setBogoMaxFree] = useState<number | "">("");

  // award rules
  const [rules, setRules] = useState<GUIRule[]>([]);
  const [selectedCouponId, setSelectedCouponId] = useState<string>("");

  const refresh = () => {
    Coupons.deliverScheduled();
    setCoupons(Coupons.getAllCoupons());
    setIssued(Coupons.getAllIssued());
  };
  useEffect(() => {
    refresh();
  }, []);

  /* ───────── actions ───────── */

  const create = () => {
    const now = Date.now();
    const meta: Coupons.CouponDef["meta"] = {
      uniquePerIssue,
      aboutText: aboutText || undefined,
      freeItemName: type === "free_item" ? freeItemName || "Ürün" : undefined,
      singlePerCustomer: singlePerCustomer || undefined,
      issueCapPerWeek: typeof capPerWeek === "number" ? capPerWeek : undefined,
      issueCooldownDays: typeof cooldownDays === "number" ? cooldownDays : undefined,
      awardRules: (rules || []).map((r) =>
        r.kind === "nth_order"
          ? ({ kind: "nth_order", n: r.n || 10, couponId: "__SELF__", expiresDays: r.expiresDays } as any)
          : ({ kind: "spent_total", minTotal: r.minTotal || 20, couponId: "__SELF__", expiresDays: r.expiresDays } as any),
      ),
      bogo:
        type === "bogo"
          ? {
              matchBy: bogoMatchBy,
              matchValue: bogoMatchValue.trim(),
              buyQty: bogoBuy,
              freeQty: bogoFree,
              maxFreePerOrder: typeof bogoMaxFree === "number" ? bogoMaxFree : undefined,
            }
          : undefined,
    };

    let def = Coupons.createCoupon({
      title,
      type,
      value,
      minCartTotal: typeof minCart === "number" ? minCart : undefined,
      perCustomerLimit: typeof perCust === "number" ? perCust : undefined,
      validFrom: now,
      validUntil: typeof validDays === "number" ? now + validDays * 24 * 3600 * 1000 : undefined,
      meta,
    });

    // prefix ile kod
    if (codePrefix) def.code = Coupons.generateCode(8, codePrefix);

    // award rule'larda self id’yi doldur
    if (def.meta?.awardRules?.length) {
      def.meta.awardRules = def.meta.awardRules.map((r: any) => ({ ...r, couponId: def.id }));
    }
    Coupons.saveCoupon(def);

    // reset
    setTitle("");
    setAboutText("");
    setFreeItemName("");
    setMinCart("");
    setPerCust("");
    setValidDays(7);
    setRules([]);
    setSinglePerCustomer(false);
    setCapPerWeek("");
    setCooldownDays("");
    setBogoMatchValue("");
    setBogoBuy(2);
    setBogoFree(1);
    setBogoMaxFree("");
    refresh();
    alert(`Gutschein oluşturuldu: ${def.code}`);
  };

  const bulkRandom = () => {
    const cnt = Number(prompt("Kaç kupon oluşturulsun? (ör. 20)") || "0");
    if (!cnt) return;
    for (let i = 0; i < cnt; i++) {
      const now = Date.now();
      const def = Coupons.createCoupon({
        title: title || `Kampanya`,
        type,
        value,
        minCartTotal: typeof minCart === "number" ? minCart : undefined,
        perCustomerLimit: typeof perCust === "number" ? perCust : undefined,
        validFrom: now,
        validUntil: typeof validDays === "number" ? now + validDays * 24 * 3600 * 1000 : undefined,
        meta: {
          uniquePerIssue,
          aboutText: aboutText || undefined,
          freeItemName: type === "free_item" ? freeItemName || "Ürün" : undefined,
          singlePerCustomer: singlePerCustomer || undefined,
          issueCapPerWeek: typeof capPerWeek === "number" ? capPerWeek : undefined,
          issueCooldownDays: typeof cooldownDays === "number" ? cooldownDays : undefined,
          bogo:
            type === "bogo"
              ? {
                  matchBy: bogoMatchBy,
                  matchValue: bogoMatchValue.trim(),
                  buyQty: bogoBuy,
                  freeQty: bogoFree,
                  maxFreePerOrder: typeof bogoMaxFree === "number" ? bogoMaxFree : undefined,
                }
              : undefined,
        },
      });
      def.code = Coupons.generateCode(8, codePrefix || "BB");
      Coupons.saveCoupon(def);
    }
    refresh();
    alert("Toplu kuponlar oluşturuldu.");
  };

  const scheduleBulk = () => {
    const id = selectedCouponId || coupons[0]?.id;
    if (!id) return alert("Önce kupon seç.");
    const count = Number(prompt("Kaç kupon dağıtılsın? (ör. 20)") || "0");
    if (!count) return;
    const days = Number(prompt("Kaç gün içinde? (ör. 7)") || "7");
    if (!days) return;
    const expires = Number(prompt("Gutscheinlar kaç gün geçerli olsun? (örn 7)") || "7");
    Coupons.scheduleBulkDistribution({ couponId: id, count, days, expiresAfterDays: expires, source: "bulk_campaign" });
    refresh();
    alert("Zamanlandı.");
  };

  const issueToPhone = () => {
    const id = selectedCouponId || coupons[0]?.id;
    if (!id) return alert("Önce kupon seç.");
    const phone = prompt("Telefon (örn. 491234567890)") || "";
    if (!phone) return;
    const days = Number(prompt("Kaç gün geçerli? (örn 14)") || "14");
    const it = Coupons.issueCoupon({ couponId: id, phone, expiresAfterDays: days, source: "manual" });
    refresh();
    alert(it ? "Verildi." : "Kısıtlardan dolayı verilmedi (tekil/haftalık limit/soğuma süresi).");
  };

  const delCoupon = (id: string) => {
    if (confirm("Löscheninsin mi?")) {
      Coupons.deleteCoupon(id);
      refresh();
    }
  };

  const exportAll = () => {
    const txt = Coupons.exportAll();
    const blob = new Blob([txt], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coupons_export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importAll = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    const ok = Coupons.importAll(txt);
    if (ok) {
      refresh();
      alert("Import OK");
    } else {
      alert("Import hatası");
    }
    ev.target.value = "";
  };

  const filteredCoupons = useMemo(() => {
    const t = filter.trim().toLowerCase();
    if (!t) return coupons;
    return coupons.filter((c) => (c.code + " " + (c.title || "")).toLowerCase().includes(t));
  }, [coupons, filter]);

  const addRule = (kind: GUIRule["kind"]) => setRules((r) => [{ id: uuid(), kind, n: 10, minTotal: 20, expiresDays: 7 }, ...r]);
  const updRule = (id: string, patch: Partial<GUIRule>) => setRules((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const rmRule = (id: string) => setRules((r) => r.filter((x) => x.id !== id));

  /* ───────── render ───────── */

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-baseline gap-4">
        <h1 className="text-2xl font-semibold">Gutscheinlar</h1>
        <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
          ← Admin
        </Link>
      </div>

      <div className="card p-4 grid md:grid-cols-3 gap-4">
        {/* Yeni kupon */}
        <div>
          <div className="font-medium mb-2">Yeni kupon</div>
          <input className="w-full p-2 mb-2 rounded-md bg-stone-800/60" placeholder="Başlık" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex gap-2 mb-2">
            <select value={type} onChange={(e) => setType(e.target.value as any)} className="p-2 rounded-md bg-stone-800/60">
              <option value="fixed">Sabit (€)</option>
              <option value="percent">Yüzde (%)</option>
              <option value="free_item">Bedava ürün</option>
              <option value="bogo">2 al 1 bedava (BOGO)</option>
            </select>
            <input type="number" className="p-2 w-28 rounded-md bg-stone-800/60" value={value} onChange={(e) => setValue(Number(e.target.value))} />
          </div>

          {type === "free_item" && (
            <input className="w-full p-2 mb-2 rounded-md bg-stone-800/60" placeholder="Ürün adı (örn. 2x İçecek)" value={freeItemName} onChange={(e) => setFreeItemName(e.target.value)} />
          )}

          {type === "bogo" && (
            <div className="rounded border border-stone-700/60 p-2 mb-2 space-y-2">
              <div className="text-sm font-medium">BOGO ayarları</div>
              <div className="flex gap-2">
                <select className="p-2 rounded-md bg-stone-800/60" value={bogoMatchBy} onChange={(e) => setBogoMatchBy(e.target.value as any)}>
                  <option value="name">Ad</option>
                  <option value="sku">SKU</option>
                  <option value="category">Etageegori</option>
                </select>
                <input className="flex-1 p-2 rounded-md bg-stone-800/60" placeholder="Eşleşme değeri (örn. Big Daddy)" value={bogoMatchValue} onChange={(e) => setBogoMatchValue(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <input type="number" className="p-2 w-24 rounded-md bg-stone-800/60" value={bogoBuy} onChange={(e) => setBogoBuy(Number(e.target.value))} />
                <span className="self-center text-sm">al →</span>
                <input type="number" className="p-2 w-24 rounded-md bg-stone-800/60" value={bogoFree} onChange={(e) => setBogoFree(Number(e.target.value))} />
                <span className="self-center text-sm">bedava</span>
                <input
                  type="number"
                  className="p-2 w-36 rounded-md bg-stone-800/60"
                  placeholder="Max bedava (ops.)"
                  value={bogoMaxFree as any}
                  onChange={(e) => setBogoMaxFree(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
            </div>
          )}

          <input
            className="w-full p-2 mb-2 rounded-md bg-stone-800/60"
            placeholder="Min sepet (örn 20)"
            value={minCart as any}
            onChange={(e) => setMinCart(e.target.value === "" ? "" : Number(e.target.value))}
          />
          <input
            className="w-full p-2 mb-2 rounded-md bg-stone-800/60"
            placeholder="Geçerlilik gün (örn 7)"
            value={validDays as any}
            onChange={(e) => setValidDays(e.target.value === "" ? "" : Number(e.target.value))}
          />
          <input
            className="w-full p-2 mb-2 rounded-md bg-stone-800/60"
            placeholder="Müşteri başı kullanım limiti (ops.)"
            value={perCust as any}
            onChange={(e) => setPerCust(e.target.value === "" ? "" : Number(e.target.value))}
          />

          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={uniquePerIssue} onChange={(e) => setUniquePerIssue(e.target.checked)} />
            Her verilişte <b>tekil kod</b> üret
          </label>

          <div className="rounded border border-stone-700/60 p-2 mb-2">
            <div className="text-sm font-medium mb-1">Aşırı-kupon koruma</div>
            <label className="flex items-center gap-2 text-sm mb-1">
              <input type="checkbox" checked={singlePerCustomer} onChange={(e) => setSinglePerCustomer(e.target.checked)} />
              Bu kupondan her müşteriye <b>en fazla 1</b> kez ver
            </label>
            <div className="flex gap-2 mb-1">
              <input
                className="p-2 w-40 rounded-md bg-stone-800/60"
                placeholder="7 günde en fazla N"
                value={capPerWeek as any}
                onChange={(e) => setCapPerWeek(e.target.value === "" ? "" : Number(e.target.value))}
              />
              <input
                className="p-2 w-48 rounded-md bg-stone-800/60"
                placeholder="Yeni kupon için soğuma (gün)"
                value={cooldownDays as any}
                onChange={(e) => setCooldownDays(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </div>
            <div className="text-xs opacity-70">Örn: 1 hafta içinde en fazla 2 kupon; en az 3 gün ara gibi.</div>
          </div>

          <textarea
            className="w-full p-2 mb-2 rounded-md bg-stone-800/60"
            rows={2}
            placeholder="Açıklama/not (müşteriye gösterilecek)"
            value={aboutText}
            onChange={(e) => setAboutText(e.target.value)}
          />

          <div className="flex gap-2 mb-2">
            <input className="p-2 rounded-md bg-stone-800/60" placeholder="Kod prefix (BB)" value={codePrefix} onChange={(e) => setCodePrefix(e.target.value)} />
            <button className="card-cta" onClick={create}>
              Oluştur
            </button>
            <button className="btn-ghost" onClick={bulkRandom}>
              Toplu oluştur
            </button>
          </div>
        </div>

        {/* Otomatik ödül kuralları */}
        <div>
          <div className="font-medium mb-2">Otomatik ödül kuralları</div>
          <div className="flex gap-2 mb-2">
            <button className="btn-ghost" onClick={() => addRule("nth_order")}>
              + N. siparişte ver
            </button>
            <button className="btn-ghost" onClick={() => addRule("spent_total")}>
              + Sepet ≥ X € ver
            </button>
          </div>
          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r.id} className="rounded border border-stone-700/60 p-2">
                {r.kind === "nth_order" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">N. sipariş:</span>
                    <input
                      type="number"
                      className="w-20 p-1 rounded-md bg-stone-800/60"
                      value={r.n || 10}
                      onChange={(e) => updRule(r.id, { n: Number(e.target.value) })}
                    />
                    <span className="text-sm">Geçerlilik (gün):</span>
                    <input
                      type="number"
                      className="w-20 p-1 rounded-md bg-stone-800/60"
                      value={r.expiresDays || 7}
                      onChange={(e) => updRule(r.id, { expiresDays: Number(e.target.value) })}
                    />
                    <button className="btn-ghost ml-auto" onClick={() => rmRule(r.id)}>
                      Löschen
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Min sepet (€):</span>
                    <input
                      type="number"
                      className="w-24 p-1 rounded-md bg-stone-800/60"
                      value={r.minTotal || 20}
                      onChange={(e) => updRule(r.id, { minTotal: Number(e.target.value) })}
                    />
                    <span className="text-sm">Geçerlilik (gün):</span>
                    <input
                      type="number"
                      className="w-20 p-1 rounded-md bg-stone-800/60"
                      value={r.expiresDays || 7}
                      onChange={(e) => updRule(r.id, { expiresDays: Number(e.target.value) })}
                    />
                    <button className="btn-ghost ml-auto" onClick={() => rmRule(r.id)}>
                      Löschen
                    </button>
                  </div>
                )}
              </div>
            ))}
            {rules.length === 0 && <div className="text-sm opacity-70">Kural eklemediysen otomatik dağıtım yapılmaz.</div>}
          </div>
        </div>

        {/* Hızlı işlemler */}
        <div>
          <div className="font-medium mb-2">Hızlı işlemler</div>
          <select className="w-full p-2 mb-2 rounded-md bg-stone-800/60" value={selectedCouponId} onChange={(e) => setSelectedCouponId(e.target.value)}>
            <option value="">— Gutschein seç —</option>
            {coupons.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
          <div className="flex gap-2 mb-2">
            <button className="btn-ghost" onClick={issueToPhone} disabled={!coupons.length}>
              Telefona ver
            </button>
            <button className="btn-ghost" onClick={scheduleBulk} disabled={!coupons.length}>
              7 günde dağıt
            </button>
          </div>

          <div className="mt-4">
            <div className="text-xs opacity-70 mb-1">Import / Export</div>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={exportAll}>
                Export JSON
              </button>
              <label className="btn-ghost cursor-pointer">
                Import
                <input type="file" accept="application/json" hidden onChange={importAll} />
              </label>
            </div>
          </div>

          <div className="mt-4">
            <input className="w-full p-2 rounded-md bg-stone-800/60" placeholder="Gutschein ara..." value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Listeler */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-3">
          <div className="mb-2 font-medium">Gutschein tanımları</div>
          <div className="space-y-2">
            {filteredCoupons.map((c) => (
              <div key={c.id} className="border rounded p-2 border-stone-700/60">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {c.code} <span className="opacity-70">— {c.title || "—"}</span>
                    </div>
                    <div className="text-xs opacity-80">
                      Tip: {c.type}
                      {" • "}Değer: {c.type === "percent" ? `%${c.value}` : `€${c.value.toFixed(2)}`}
                      {" • "}Min: {c.minCartTotal ?? "—"}
                      {" • "}Unique per issue: {c.meta?.uniquePerIssue ? "✓" : "—"}
                    </div>
                    {!!(c.meta?.singlePerCustomer || c.meta?.issueCapPerWeek || c.meta?.issueCooldownDays) && (
                      <div className="text-xs opacity-80 mt-1">
                        Anti-abuse: {c.meta?.singlePerCustomer ? "1x/kişi" : ""}
                        {c.meta?.issueCapPerWeek ? `, 7g≤${c.meta.issueCapPerWeek}` : ""}
                        {c.meta?.issueCooldownDays ? `, ${c.meta.issueCooldownDays}g soğuma` : ""}
                      </div>
                    )}
                    <pre className="text-xs opacity-70 mt-1 whitespace-pre-wrap">{Coupons.describeCoupon(c)}</pre>
                    <div className="text-xs opacity-60 mt-1">
                      Geçerlilik: {fmtDT(c.validFrom)} → {fmtDT(c.validUntil)}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        navigator.clipboard?.writeText(c.code);
                        alert("Kopyalandı");
                      }}
                    >
                      Kodu kopyala
                    </button>
                    <button className="btn-ghost" onClick={() => delCoupon(c.id)}>
                      Löschen
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {!filteredCoupons.length && <div className="text-sm opacity-70">Kayıt yok.</div>}
          </div>
        </div>

        <div className="card p-3">
          <div className="mb-2 font-medium">Verilmiş kuponlar</div>
          <div className="space-y-2 max-h-96 overflow-auto pr-1">
            {issued.map((i) => (
              <div key={i.id} className="border rounded p-2 border-stone-700/60">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {i.code} <span className="opacity-70">— {i.source}</span>
                    </div>
                    <div className="text-xs opacity-70">
                      {i.assignedToPhone ? `Telefon: ${i.assignedToPhone}` : "Genel"} • Durum:{" "}
                      {i.note === "scheduled" ? "Zamanlandı" : i.note === "cancelled" ? "İptal" : "Hazır"}
                    </div>
                    <div className="text-xs opacity-70">
                      Issued: {fmtDT(i.issuedAt)} • Expires: {fmtDT(i.expiresAt)}
                    </div>
                    <div className="text-xs opacity-70">Used: {i.used ? fmtDT(i.usedAt) : "Hayır"}</div>
                    {(() => {
                      const def = coupons.find((c) => c.id === i.couponId);
                      if (!def) return null;
                      return <pre className="text-xs opacity-70 mt-1 whitespace-pre-wrap">{Coupons.describeCoupon(def, i)}</pre>;
                    })()}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        navigator.clipboard?.writeText(i.code);
                        alert("Kopyalandı");
                      }}
                    >
                      Kodu kopyala
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        const left = Coupons.getAllIssued().filter((x) => x.id !== i.id);
                        localStorage.setItem("bb_issued_coupons_v1", JSON.stringify(left));
                        refresh();
                      }}
                    >
                      Löschen
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {!issued.length && <div className="text-sm opacity-70">Kayıt yok.</div>}
          </div>
        </div>
      </div>
    </main>
  );
}
