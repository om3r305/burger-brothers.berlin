"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

/** LS keys */
const LS_CUSTOMERS = "bb_customers_v1";
const LS_ORDERS = "bb_orders_v1";

/** Tipler */
type Stats = { orders: number; totalSpent: number };
type Customer = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  plz?: string;
  notes?: string;
  vip?: boolean;
  blocked?: boolean;
  emailOptIn?: boolean; // kampanya onayı olarak kullanıyoruz
  createdAt?: number;
  lastOrderAt?: number;
  stats?: Stats;
};

type Order = {
  id?: string;
  ts: number;
  mode?: "pickup" | "delivery";
  plz?: string | null;
  merchandise?: number;
  discount?: number;
  surcharges?: number;
  total: number;
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
  };
};

/** utils */
const rid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const fmtEur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});

function load<T>(k: string, fb: T): T {
  try {
    const raw = localStorage.getItem(k);
    const v = raw ? (JSON.parse(raw) as T) : fb;
    return Array.isArray(v) || typeof v === "object" ? v : fb;
  } catch {
    return fb;
  }
}
function save<T>(k: string, v: T) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

/** WhatsApp helper */
const waNumber = (n: string) => n.replace(/[^\d]/g, "");
const waHref = (phone: string, text: string) =>
  `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

/** Bileşen */
export default function AdminCustomersPage() {
  /* data */
  const [rows, setRows] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    setRows(load<Customer[]>(LS_CUSTOMERS, []));
    setOrders(load<Order[]>(LS_ORDERS, []));
  }, []);

  const persistCustomers = (next: Customer[]) => {
    setRows(next);
    save(LS_CUSTOMERS, next);
  };
  const persistOrders = (next: Order[]) => {
    setOrders(next);
    save(LS_ORDERS, next);
  };

  /* filtreler / arama */
  const [q, setQ] = useState("");
  const [onlyVIP, setOnlyVIP] = useState(false);
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [onlyOptIn, setOnlyOptIn] = useState(false);
  const [plzFilter, setPlzFilter] = useState("");

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    let arr = rows.slice();
    if (onlyVIP) arr = arr.filter((c) => c.vip);
    if (onlyBlocked) arr = arr.filter((c) => c.blocked);
    if (onlyOptIn) arr = arr.filter((c) => c.emailOptIn);
    if (plzFilter.trim()) arr = arr.filter((c) => (c.plz || "").includes(plzFilter.trim()));
    if (t) {
      arr = arr.filter((c) =>
        [c.name, c.phone || "", c.email || "", c.address || "", c.plz || "", c.notes || ""]
          .join(" ")
          .toLowerCase()
          .includes(t)
      );
    }
    // VIP → lastOrderAt → name
    arr.sort(
      (a, b) =>
        Number(b.vip) - Number(a.vip) ||
        (b.lastOrderAt || 0) - (a.lastOrderAt || 0) ||
        a.name.localeCompare(b.name, "de")
    );
    return arr;
  }, [rows, q, onlyVIP, onlyBlocked, onlyOptIn, plzFilter]);

  /* seçili / bulk */
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const selectedRows = useMemo(
    () => list.filter((c) => selectedIds.includes(c.id)),
    [list, selectedIds]
  );
  const toggleRow = (id: string, v?: boolean) =>
    setSelected((s) => ({ ...s, [id]: v ?? !s[id] }));
  const clearSelection = () => setSelected({});

  /* kampanya composer */
  const [campaignMsg, setCampaignMsg] = useState(
    "Merhaba! 🍔 Bu hafta özel: 20€ ve üzeri siparişlerde 5€ indirim. Kod: BB-HAFTA. 7 gün geçerli!"
  );
  const [campaignDelayMs, setCampaignDelayMs] = useState(1500);
  const [campaignPreview, setCampaignPreview] = useState(true);

  const selectedWithPhone = useMemo(
    () => selectedRows.filter((c) => (c.phone || "").trim().length >= 10),
    [selectedRows]
  );

  const sendCampaignWhatsApp = () => {
    if (!selectedWithPhone.length) return alert("Telefonu olan seçili müşteri yok.");
    // Çoklu pencere açmayı tarayıcı engelleyebilir; aralıklı açıyoruz
    let i = 0;
    const timer = setInterval(() => {
      if (i >= selectedWithPhone.length) {
        clearInterval(timer);
        return;
      }
      const c = selectedWithPhone[i++];
      const url = waHref(c.phone!, campaignMsg);
      window.open(url, "_blank");
    }, Math.max(600, campaignDelayMs || 1200));
    alert(
      `WhatsApp pencereleri sırayla açılacak (${selectedWithPhone.length} kişi, ~${Math.ceil(
        (selectedWithPhone.length * Math.max(600, campaignDelayMs)) / 1000
      )} sn).`
    );
  };

  const exportSelectedCSV = () => {
    const rows = selectedRows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone || "",
      email: c.email || "",
      plz: c.plz || "",
      address: c.address || "",
      optIn: c.emailOptIn ? "yes" : "no",
      orders: c.stats?.orders ?? 0,
      total: c.stats?.totalSpent ?? 0,
      lastOrderAt: c.lastOrderAt ? new Date(c.lastOrderAt).toISOString() : "",
    }));
    const keys = Object.keys(rows[0] || {});
    const csv =
      [keys.join(","), ...rows.map((r) => keys.map((k) => String((r as any)[k]).replace(/,/g, " ")).join(","))].join(
        "\n"
      );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customers_selected.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  /* müşteri düzenleme mini form (üstte hızlı) */
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [plz, setPlz] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setHinweises] = useState("");
  const [vip, setVip] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [optin, setOptin] = useState(false);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setPhone("");
    setEmail("");
    setPlz("");
    setAddress("");
    setHinweises("");
    setVip(false);
    setBlocked(false);
    setOptin(false);
  };

  const loadToForm = (c: Customer) => {
    setEditId(c.id);
    setName(c.name);
    setPhone(c.phone || "");
    setEmail(c.email || "");
    setPlz(c.plz || "");
    setAddress(c.address || "");
    setHinweises(c.notes || "");
    setVip(!!c.vip);
    setBlocked(!!c.blocked);
    setOptin(!!c.emailOptIn);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveForm = () => {
    if (!name.trim()) return alert("İsim gerekli.");
    const base: Customer = {
      id: editId || rid(),
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      plz: plz.trim() || undefined,
      address: address.trim() || undefined,
      notes: notes.trim() || undefined,
      vip,
      blocked,
      emailOptIn: optin,
      createdAt: editId ? rows.find((r) => r.id === editId)?.createdAt || Date.now() : Date.now(),
      lastOrderAt: rows.find((r) => r.id === editId)?.lastOrderAt,
      stats: rows.find((r) => r.id === editId)?.stats || { orders: 0, totalSpent: 0 },
    };
    persistCustomers(editId ? rows.map((r) => (r.id === editId ? base : r)) : [base, ...rows]);
    resetForm();
  };

  const del = (id: string) => {
    if (!confirm("Löscheninsin mi?")) return;
    persistCustomers(rows.filter((r) => r.id !== id));
    if (editId === id) resetForm();
  };

  /* merge (birleştir) */
  const [mergeA, setMergeA] = useState("");
  const [mergeB, setMergeB] = useState("");
  const [primary, setPrimary] = useState<"A" | "B">("A");

  const mergeNow = () => {
    const a = rows.find((x) => x.id === mergeA);
    const b = rows.find((x) => x.id === mergeB);
    if (!a || !b) return alert("Ungültig ID.");
    if (a.id === b.id) return alert("A ve B aynı.");
    const keep = primary === "A" ? a : b;
    const drop = primary === "A" ? b : a;

    // alanları doldur
    const merged: Customer = {
      ...keep,
      name: keep.name || drop.name,
      phone: keep.phone || drop.phone,
      email: keep.email || drop.email,
      address: keep.address || drop.address,
      plz: keep.plz || drop.plz,
      notes: [keep.notes, drop.notes].filter(Boolean).join(" | ") || undefined,
      vip: keep.vip || drop.vip,
      blocked: keep.blocked || drop.blocked,
      emailOptIn: keep.emailOptIn || drop.emailOptIn,
      createdAt: Math.min(keep.createdAt || Date.now(), drop.createdAt || Date.now()),
      lastOrderAt: Math.max(keep.lastOrderAt || 0, drop.lastOrderAt || 0) || undefined,
      stats: {
        orders: (keep.stats?.orders || 0) + (drop.stats?.orders || 0),
        totalSpent: (keep.stats?.totalSpent || 0) + (drop.stats?.totalSpent || 0),
      },
    };

    // siparişlerde referansı normalize et (telefon öncelikli)
    const canonPhone = merged.phone;
    const canonName = merged.name;
    const nextOrders = orders.map((o) => {
      const ph = o.customer?.phone;
      const nm = o.customer?.name;
      const dropPhone = drop.phone;
      const dropName = drop.name;
      const matches =
        (dropPhone && ph && ph === dropPhone) || (!dropPhone && !ph && nm && dropName && nm === dropName);
      if (!matches) return o;
      return {
        ...o,
        customer: {
          ...o.customer,
          phone: canonPhone || o.customer?.phone,
          name: canonName || o.customer?.name,
        },
      };
    });

    // kaydet
    const nextCustomers = rows
      .map((c) => (c.id === keep.id ? merged : c))
      .filter((c) => c.id !== drop.id);
    persistCustomers(nextCustomers);
    persistOrders(nextOrders);

    alert("Birleştirildi ✅");
    setMergeA("");
    setMergeB("");
  };

  /* otodedupe (telefon/e-posta) */
  const autoDeduplicate = () => {
    // aynı phone veya email olanları grupla, en eski createdAt kalır
    const byPhone = new Map<string, Customer[]>();
    const byEmail = new Map<string, Customer[]>();
    for (const c of rows) {
      if (c.phone) {
        const k = c.phone.replace(/[^\d]/g, "");
        byPhone.set(k, [...(byPhone.get(k) || []), c]);
      }
      if (c.email) {
        const k = c.email.toLowerCase();
        byEmail.set(k, [...(byEmail.get(k) || []), c]);
      }
    }
    const toMergePairs: [Customer, Customer][] = [];
    const visitGroup = (arr: Customer[]) => {
      if (arr.length < 2) return;
      // createdAt küçük olanı tut
      const sorted = arr.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const keep = sorted[0];
      for (let i = 1; i < sorted.length; i++) toMergePairs.push([keep, sorted[i]]);
    };
    for (const v of byPhone.values()) visitGroup(v);
    for (const v of byEmail.values()) visitGroup(v);

    if (!toMergePairs.length) return alert("Birleştirilecek çift bulunamadı.");

    let nextCustomers = rows.slice();
    let nextOrders = orders.slice();

    for (const [keep, drop] of toMergePairs) {
      const merged: Customer = {
        ...keep,
        name: keep.name || drop.name,
        phone: keep.phone || drop.phone,
        email: keep.email || drop.email,
        address: keep.address || drop.address,
        plz: keep.plz || drop.plz,
        notes: [keep.notes, drop.notes].filter(Boolean).join(" | ") || undefined,
        vip: keep.vip || drop.vip,
        blocked: keep.blocked || drop.blocked,
        emailOptIn: keep.emailOptIn || drop.emailOptIn,
        createdAt: Math.min(keep.createdAt || Date.now(), drop.createdAt || Date.now()),
        lastOrderAt: Math.max(keep.lastOrderAt || 0, drop.lastOrderAt || 0) || undefined,
        stats: {
          orders: (keep.stats?.orders || 0) + (drop.stats?.orders || 0),
          totalSpent: (keep.stats?.totalSpent || 0) + (drop.stats?.totalSpent || 0),
        },
      };
      nextCustomers = nextCustomers
        .map((c) => (c.id === keep.id ? merged : c))
        .filter((c) => c.id !== drop.id);

      // sipariş düzelt
      nextOrders = nextOrders.map((o) => {
        const matches =
          (drop.phone && o.customer?.phone === drop.phone) ||
          (!drop.phone && !o.customer?.phone && o.customer?.name === drop.name);
        if (!matches) return o;
        return {
          ...o,
          customer: { ...o.customer, phone: merged.phone || o.customer?.phone, name: merged.name || o.customer?.name },
        };
      });
    }

    persistCustomers(nextCustomers);
    persistOrders(nextOrders);
    alert(`Otomatik birleştirme tamam: ${toMergePairs.length} çift.`);
  };

  /* render */
  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Kunden (Müşteriler)</h1>
        <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
          ← Admin
        </Link>
      </div>

      {/* Hızlı düzenleme formu */}
      <div className="card p-4">
        <div className="mb-2 font-medium">{editId ? "Müşteri Düzenle" : "Yeni Müşteri"}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Name *">
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          </Field>
          <Field label="Telefon">
            <input className="inp" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49…" />
          </Field>
          <Field label="E-posta">
            <input className="inp" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="mail@…" />
          </Field>
          <Field label="PLZ">
            <input className="inp" value={plz} onChange={(e) => setPlz(e.target.value)} placeholder="13507" />
          </Field>
          <Field label="Adresse">
            <input className="inp" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Straße Hausnr., Ort" />
          </Field>
          <Field label="Hinweis">
            <input className="inp" value={notes} onChange={(e) => setHinweises(e.target.value)} placeholder="Hinweis…" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={vip} onChange={(e) => setVip(e.target.checked)} /> VIP
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} /> Engelli
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={optin} onChange={(e) => setOptin(e.target.checked)} /> Kampanya izni (opt-in)
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="card-cta" onClick={saveForm}>
            {editId ? "Kaydet" : "Ekle"}
          </button>
          {editId && (
            <button className="btn-ghost" onClick={resetForm}>
              İptal
            </button>
          )}
        </div>
      </div>

      {/* Filtre + toplu bar */}
      <div className="card p-4">
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-5">
          <input className="inp" placeholder="Ara (ad/telefon/e-posta/adres/not)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyVIP} onChange={(e) => setOnlyVIP(e.target.checked)} /> VIP
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyBlocked} onChange={(e) => setOnlyBlocked(e.target.checked)} /> Engelli
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyOptIn} onChange={(e) => setOnlyOptIn(e.target.checked)} /> Sadece opt-in
          </label>
          <input className="inp" placeholder="PLZ filtre (örn 13507)" value={plzFilter} onChange={(e) => setPlzFilter(e.target.value)} />
        </div>

        <div className="rounded-md border border-stone-700/60 p-3 bg-stone-950/50">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm">
              Seçili: <b>{selectedIds.length}</b> / Toplam: <b>{list.length}</b>
            </span>
            <button className="btn-ghost" onClick={() => list.forEach((c) => toggleRow(c.id, true))}>
              Tümünü seç
            </button>
            <button className="btn-ghost" onClick={clearSelection}>
              Temizle
            </button>
            <span className="ml-auto text-xs opacity-70">
              İpucu: listeden satıra tıklayarak seç/de-seç yapabilirsin.
            </span>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <div className="text-sm font-medium mb-1">Kampanya Mesajı</div>
              <textarea
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 p-2 text-sm outline-none"
                rows={campaignPreview ? 4 : 6}
                value={campaignMsg}
                onChange={(e) => setCampaignMsg(e.target.value)}
              />
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span>Gecikme (ms):</span>
                <input
                  type="number"
                  className="w-24 rounded border border-stone-700/60 bg-stone-950 p-1"
                  value={campaignDelayMs}
                  onChange={(e) => setCampaignDelayMs(Number(e.target.value))}
                />
                <button className="btn-ghost" onClick={() => copy(campaignMsg)}>
                  Mesajı kopyala
                </button>
                <button
                  className="btn-ghost"
                  onClick={() =>
                    copy(
                      selectedWithPhone
                        .map((c) => waHref(c.phone!, campaignMsg))
                        .join("\n")
                    )
                  }
                  disabled={!selectedWithPhone.length}
                >
                  WhatsApp linkleri kopyala
                </button>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Toplu Aksiyonlar</div>
              <div className="flex flex-col gap-2">
                <button
                  className="card-cta"
                  onClick={sendCampaignWhatsApp}
                  disabled={!selectedWithPhone.length}
                  title="Seçili müşteriler için WhatsApp Web'ı sırayla açar"
                >
                  WhatsApp’la gönder ({selectedWithPhone.length})
                </button>
                <button className="btn-ghost" onClick={exportSelectedCSV} disabled={!selectedRows.length}>
                  Seçili → CSV
                </button>
              </div>

              <div className="mt-4 text-xs opacity-70">
                Hinweis: Tarayıcı güvenlik politikaları çoklu pencere açmayı sınırlayabilir. Gecikmeyi (ms) artırman gerekebilir.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Birleştirme araçları */}
      <div className="card p-4">
        <div className="mb-2 font-medium">Müşteri Birleştirme</div>
        <div className="grid md:grid-cols-5 gap-2">
          <input className="inp" placeholder="ID A" value={mergeA} onChange={(e) => setMergeA(e.target.value)} />
          <input className="inp" placeholder="ID B" value={mergeB} onChange={(e) => setMergeB(e.target.value)} />
          <select
            className="inp"
            value={primary}
            onChange={(e) => setPrimary(e.target.value as any)}
            title="Hangi kayıt ana kalsın?"
          >
            <option value="A">A ana</option>
            <option value="B">B ana</option>
          </select>
          <button className="btn-ghost" onClick={mergeNow}>
            Birleştir
          </button>
          <button className="btn-ghost" onClick={autoDeduplicate}>
            Otomatik (tel/e-posta)
          </button>
        </div>
      </div>

      {/* Liste */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-stone-900/80 backdrop-blur">
            <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
              <th>Seç</th>
              <th>Ad</th>
              <th>Tel</th>
              <th>E-posta</th>
              <th>PLZ</th>
              <th>Adresse</th>
              <th>VIP</th>
              <th>Blok</th>
              <th>Opt-in</th>
              <th>Adet</th>
              <th>Umsatz</th>
              <th>Son</th>
              <th className="text-right">Aksiyon</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="border-t border-stone-800/60 hover:bg-stone-900/40">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={!!selected[c.id]} onChange={() => toggleRow(c.id)} />
                </td>
                <td className="px-3 py-2">
                  <button className="underline-offset-2 hover:underline" onClick={() => loadToForm(c)}>
                    {c.name}
                  </button>
                </td>
                <td className="px-3 py-2">{c.phone || "—"}</td>
                <td className="px-3 py-2">{c.email || "—"}</td>
                <td className="px-3 py-2">{c.plz || "—"}</td>
                <td className="px-3 py-2">{c.address || "—"}</td>
                <td className="px-3 py-2">{c.vip ? "✓" : "—"}</td>
                <td className="px-3 py-2">{c.blocked ? "✓" : "—"}</td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!c.emailOptIn}
                    onChange={() =>
                      persistCustomers(
                        rows.map((r) => (r.id === c.id ? { ...r, emailOptIn: !r.emailOptIn } : r))
                      )
                    }
                    title="Kampanya izni"
                  />
                </td>
                <td className="px-3 py-2">{c.stats?.orders ?? 0}</td>
                <td className="px-3 py-2">{fmtEur(c.stats?.totalSpent ?? 0)}</td>
                <td className="px-3 py-2">{c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    {c.phone && (
                      <a
                        className="btn-ghost"
                        href={waHref(c.phone, campaignMsg)}
                        target="_blank"
                        rel="noreferrer"
                        title="Bu müşteriye WhatsApp gönder"
                      >
                        WhatsApp
                      </a>
                    )}
                    <button className="btn-ghost" onClick={() => copy(c.id)} title="ID kopyala">
                      ID
                    </button>
                    <button className="btn-ghost" onClick={() => loadToForm(c)}>
                      Düzenle
                    </button>
                    <button className="btn-ghost" onClick={() => del(c.id)}>
                      Löschen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td className="px-3 py-4 text-sm opacity-70" colSpan={13}>
                  Kayıt yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/** küçük label helper */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-300/80">{label}</span>
      {children}
      <style jsx global>{`
        .card {
          border: 1px solid rgba(120, 113, 108, 0.6);
          background: rgba(28, 25, 23, 0.6);
          border-radius: 12px;
        }
        .inp {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(120, 113, 108, 0.6);
          background: #0b0b0b;
          outline: none;
        }
        .btn-ghost {
          padding: 0.4rem 0.7rem;
          border: 1px solid rgba(120, 113, 108, 0.6);
          border-radius: 999px;
          background: rgba(28, 25, 23, 0.5);
        }
        .card-cta {
          padding: 0.55rem 1rem;
          border-radius: 999px;
          font-weight: 600;
          background: #10b981;
          color: #00110a;
        }
      `}</style>
    </label>
  );
}
