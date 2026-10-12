"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { berlinDateKey, reportRange, summarizePaymentRows, type PaymentReportRow, type ReportPeriod } from "@/lib/reporting";
import type { VisitorDay } from "@/lib/server/analytics-report";

type OrderDay = { date: string; orders: number; cancelled: number; revenue: number; customers: number; unidentified: number; pickup: number; delivery: number };
type Overview = { visitors: VisitorDay[]; orders: OrderDay[] };
const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
const num = (n: number) => new Intl.NumberFormat("tr-TR").format(n);
const time = (ms: number) => new Date(ms).toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
const typeLabels: Record<string, string> = { charge: "Kart ödemesi", payment: "Ödeme", refund: "İade", payment_refund: "İade", stripe_fee: "Stripe ek ücreti", stripe_fx_fee: "Döviz ücreti", tax_fee: "Vergi hizmet ücreti", payout: "Banka aktarımı", payout_cancel: "Aktarım iptali", payout_failure: "Başarısız aktarım" };
function csv(name: string, rows: Array<Array<string | number>>) {
  const text = "\uFEFF" + rows.map((row) => row.map((value) => {
    const s = String(value), safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

export default function AdminStatsPage() {
  const [period, setPeriod] = useState<ReportPeriod>("day");
  const [date, setDate] = useState(() => berlinDateKey());
  const [refresh, setRefresh] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [paymentRows, setPaymentRows] = useState<PaymentReportRow[]>([]);
  const [paymentMode, setPaymentMode] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [paymentError, setPaymentError] = useState("");
  const [generatedAt, setGeneratedAt] = useState("");
  const [showAll, setShowAll] = useState(false);
  const range = useMemo(() => { try { return reportRange(period, date); } catch { return null; } }, [period, date]);

  useEffect(() => {
    const controller = new AbortController();
    setOverview(null); setError(""); setPaymentRows([]); setPaymentMode(""); setGeneratedAt("");
    setPaymentLoading(true); setPaymentError(""); setShowAll(false);
    if (!range) { setError("Geçerli bir tarih seçin."); setPaymentLoading(false); return () => controller.abort(); }
    const query = new URLSearchParams({ period, date });
    const get = async (url: string) => {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Rapor alınamadı.");
      return data;
    };
    void get(`/api/admin/reports/overview?${query}`).then((data) => {
      if (!controller.signal.aborted) setOverview(data);
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    void (async () => {
      let cursor = "", mode = "";
      const rows = new Map<string, PaymentReportRow>();
      do {
        const pageQuery = new URLSearchParams(query);
        if (cursor) pageQuery.set("cursor", cursor);
        const data = await get(`/api/admin/reports/payments?${pageQuery}`);
        if (controller.signal.aborted) return;
        if (mode && data.mode !== mode) throw new Error("Stripe modu değişti. Raporu yenileyin.");
        mode = data.mode; setPaymentMode(mode);
        for (const row of data.rows) rows.set(row.id, row);
        setPaymentRows(Array.from(rows.values())); setGeneratedAt(data.generatedAt);
        const next = data.nextCursor || "";
        if (next && next === cursor) throw new Error("Stripe sayfaları tamamlanamadı. Raporu yenileyin.");
        cursor = next;
      } while (cursor && !controller.signal.aborted);
      if (!controller.signal.aborted) setPaymentLoading(false);
    })().catch((e) => { if (!controller.signal.aborted) { setPaymentError(e.message); setPaymentLoading(false); } });
    return () => controller.abort();
  }, [period, date, refresh, range]);

  const order = overview?.orders.find((row) => row.date === "total");
  const visits = useMemo(() => (overview?.visitors || []).reduce((s, d) => ({
    views: s.views + d.views, sessions: s.sessions + d.sessions, web: s.web + d.webViews,
    app: s.app + d.appViews, unknown: s.unknown + d.unknownViews, unidentified: s.unidentified + d.unidentifiedViews,
  }), { views: 0, sessions: 0, web: 0, app: 0, unknown: 0, unidentified: 0 }), [overview]);
  const payments = useMemo(() => summarizePaymentRows(paymentRows), [paymentRows]);
  const complete = !paymentLoading && !paymentError;
  const trend = useMemo(() => {
    if (!range || !overview) return [];
    const v = new Map(overview.visitors.map((d) => [d.date, d]));
    const o = new Map(overview.orders.map((d) => [d.date, d]));
    const groups = new Map<string, { date: string; views: number; sessions: number; orders: number; revenue: number }>();
    const day = new Date(`${range.startDate}T00:00:00Z`);
    while (day.toISOString().slice(0, 10) < range.endDate) {
      const key = day.toISOString().slice(0, 10), group = period === "year" ? key.slice(0, 7) : key;
      const row = groups.get(group) || { date: group, views: 0, sessions: 0, orders: 0, revenue: 0 };
      row.views += v.get(key)?.views || 0; row.sessions += v.get(key)?.sessions || 0;
      row.orders += o.get(key)?.orders || 0; row.revenue += o.get(key)?.revenue || 0;
      groups.set(group, row); day.setUTCDate(day.getUTCDate() + 1);
    }
    return Array.from(groups.values());
  }, [overview, range, period]);
  const paths = useMemo(() => {
    const sums = new Map<string, number>();
    for (const day of overview?.visitors || []) for (const p of day.paths) sums.set(p.path, (sums.get(p.path) || 0) + p.views);
    return Array.from(sums).sort((a, b) => b[1] - a[1]);
  }, [overview]);
  const move = (direction: number) => {
    if (!range) return;
    const next = new Date(`${range.startDate}T00:00:00Z`);
    if (period === "year") next.setUTCFullYear(next.getUTCFullYear() + direction);
    else if (period === "month") next.setUTCMonth(next.getUTCMonth() + direction);
    else next.setUTCDate(next.getUTCDate() + direction * (period === "week" ? 7 : 1));
    setDate(next.toISOString().slice(0, 10));
  };
  const count = (n?: number) => overview ? num(n || 0) : "—";
  const money = (n: number) => complete ? eur(n / 100) : "—";

  return <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-xs uppercase tracking-widest text-amber-400">Burger Brothers Berlin</p><h1 className="mt-1 text-3xl font-bold">Raporlar</h1><p className="mt-2 text-sm text-stone-400">Ziyaretçiler, siparişler ve ödeme kesintileri</p></div>
      <Link href="/admin/stats/details" className="btn-ghost">Ürün / sipariş detayları →</Link>
    </div>
    <section className="card flex flex-wrap items-end gap-3" aria-label="Rapor dönemi">
      <div><span className="mb-2 block text-sm text-stone-400">Dönem</span><div className="flex flex-wrap gap-2">
        {([["day", "Gün"], ["week", "Hafta"], ["month", "Ay"], ["year", "Yıl"]] as const).map(([key, label]) => <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key)} className={`rounded-lg px-4 py-2 font-semibold ${period === key ? "bg-amber-400 text-black" : "bg-stone-800 text-stone-200"}`}>{label}</button>)}
      </div></div>
      <label className="text-sm text-stone-400">Tarih<input aria-label="Rapor tarihi" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-2 block rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-white" /></label>
      <button onClick={() => move(-1)} className="btn-ghost" aria-label="Önceki dönem">←</button><button onClick={() => move(1)} className="btn-ghost" aria-label="Sonraki dönem">→</button>
      <button onClick={() => setDate(berlinDateKey())} className="btn-ghost">Bugün</button><button onClick={() => setRefresh((n) => n + 1)} className="btn-ghost">Yenile</button>
      <p className="w-full text-xs text-stone-400">{range ? `${range.startDate} – ${new Date(Date.parse(`${range.endDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)}` : "Tarih seçin"} · Berlin saati · Hafta pazartesi başlar</p>
    </section>

    <section className="space-y-4" aria-labelledby="visits-heading">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="visits-heading" className="text-xl font-semibold">Ziyaretçi ve sipariş raporu</h2><button className="btn-ghost disabled:opacity-40" disabled={!overview} onClick={() => csv(`ziyaret-siparis-${period}-${date}.csv`, [["Dönem", "Görüntüleme", "Günlük tekil toplam", "Sipariş", "Ciro EUR"], ...trend.map((r) => [r.date, r.views, r.sessions, r.orders, r.revenue.toFixed(2)])])}>CSV indir</button></div>
      {error && <Notice error>{error}</Notice>}{!overview && !error && <p role="status" className="text-sm text-stone-400">Ziyaret ve sipariş kayıtları yükleniyor…</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI title="Sayfa görüntüleme" value={count(visits.views)} /><KPI title={period === "day" ? "Tekil ziyaretçi oturumları" : "Günlük tekil ziyaret toplamı"} value={count(visits.sessions)} />
        <KPI title="Sipariş sayısı" value={count(order?.orders)} /><KPI title="Sipariş veren müşteri" value={count(order?.customers)} />
        <KPI title="Sipariş cirosu" value={overview ? eur(order?.revenue || 0) : "—"} /><KPI title="Ortalama sipariş" value={overview ? eur(order?.orders ? order.revenue / order.orders : 0) : "—"} />
        <KPI title="Teslimat / gel-al" value={overview ? `${count(order?.delivery)} / ${count(order?.pickup)}` : "—"} /><KPI title="İptal edilen sipariş" value={count(order?.cancelled)} />
      </div>
      <Notice>Ziyaretler yalnızca analiz izni veren müşterilerden ölçülür. Yönetim, mutfak, sürücü ve vitrin ekranları sayılmaz. Günlük tekil değer bir tarayıcı/uygulama oturumudur; hafta ve yılda günlük değerler toplanır, aynı kişi farklı günlerde tekrar sayılabilir. Sipariş sayısı tüm müşteri kanallarını içerir; bekleyen/başarısız ödemeler ve iptaller satışa dahil değildir.</Notice>
      {!!order?.unidentified && <Notice>{num(order.unidentified)} siparişte müşteri kimliği yok veya anonimleştirilmiş. Bu siparişler ciroya dahildir; tekil müşteri sayısı eksik olabilir.</Notice>}
      {!!visits.unidentified && <Notice>{num(visits.unidentified)} görüntülemede oturum kimliği yok. Tekil ziyaret sayısı bu görüntülemeleri kapsamaz.</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card"><h3 className="mb-3 font-semibold">Web / uygulama görüntülemeleri</h3><Table headers={["Kaynak", "Görüntüleme"]} rows={overview ? [["Web tarayıcısı", num(visits.web)], ["Yüklü uygulama / ana ekran", num(visits.app)], ["Eski / bilinmeyen kaynak", num(visits.unknown)]] : []} /><p className="mt-3 text-xs text-stone-400">Uygulama ayrımı bu güncellemeyle başlar. Eski kayıtlara kaynak atanmamıştır.</p></div>
        <div className="card"><h3 className="mb-3 font-semibold">En çok ziyaret edilen sayfalar</h3><Table headers={["Sayfa", "Görüntüleme"]} rows={paths.slice(0, 10).map(([p, views]) => [p, num(views)])} /></div>
      </div>
      <div className="card"><h3 className="mb-3 font-semibold">{period === "year" ? "Aylık" : "Günlük"} gelişim</h3><Table headers={["Dönem", "Görüntüleme", "Günlük tekil toplam", "Sipariş", "Ciro"]} rows={trend.map((r) => [r.date, num(r.views), num(r.sessions), num(r.orders), eur(r.revenue)])} /><p className="mt-3 text-xs text-stone-400">Günlük toplamlar ham ziyaret kayıtları temizlenmeden önce saklanır. Daha önce silinmiş ziyaretler yeniden oluşturulamaz. Ciro, Stripe kesintisi ve iadeler düşülmeden önceki iptal edilmemiş sipariş tutarıdır.</p></div>
    </section>

    <section className="space-y-4" aria-labelledby="payments-heading">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-3"><h2 id="payments-heading" className="text-xl font-semibold">Stripe ödeme ve kesinti raporu</h2>{paymentMode && <span className={`rounded-full px-3 py-1 text-xs font-bold ${paymentMode === "test" ? "bg-amber-400/20 text-amber-300" : "bg-green-400/20 text-green-300"}`}>{paymentMode === "test" ? "TEST ORTAMI" : "CANLI ÖDEMELER"}</span>}</div>
        <button disabled={!complete} className="btn-ghost disabled:opacity-40" onClick={() => csv(`stripe-${paymentMode}-${period}-${date}.csv`, [["Stripe modu", "İşlem", "Tarih Berlin", "Tür", "Yöntem", "Brüt EUR", "Kesinti EUR", "Net EUR", "Durum"], ...paymentRows.map((r) => [paymentMode, r.id, time(r.created * 1000), r.type, r.method, (r.amount / 100).toFixed(2), (r.fee / 100).toFixed(2), (r.net / 100).toFixed(2), r.status])])}>CSV indir</button></div>
      {paymentMode === "test" && <Notice>Test ortamındaki tutarlar ve ücretler örnek kayıtlardır. Gerçek para kesintisi veya canlı hesabın tarifesi değildir.</Notice>}
      {paymentLoading && <p role="status" className="text-sm text-stone-400">Stripe kayıtları yükleniyor… {paymentRows.length ? `${num(paymentRows.length)} hareket alındı; toplamlar tamamlanınca gösterilecek.` : ""}</p>}
      {paymentError && <Notice error>{paymentError} Toplamlar doğrulanamadığı için gösterilmedi.</Notice>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI title="Tahsil edilen brüt" value={money(payments.gross)} /><KPI title="Stripe kesintileri" value={money(payments.fees)} /><KPI title="İadeler" value={money(payments.refunds)} /><KPI title="Stripe net bakiye hareketi" value={money(payments.net)} />
        <KPI title="Ödeme hareketi sayısı" value={complete ? num(payments.payments) : "—"} /><KPI title="Efektif kesinti oranı" value={complete && payments.gross > 0 ? `%${(payments.fees / payments.gross * 100).toFixed(2)}` : "—"} /><KPI title="Diğer bakiye hareketleri" value={money(payments.other)} /><KPI title="Banka aktarımı (net)" value={money(payments.payouts)} />
      </div>
      <Notice>Stripe hesabının seçilen dönemdeki EUR bakiye hareketleri gösterilir; Dashboard üzerinden yapılan testler de dahil olabilir. Kesintiler Stripe kayıtlarından gelir. Ek hizmet ücretleri ve döviz ücretleri kesinti toplamına dahildir. Net bakiye = brüt − iadeler − kesintiler + diğer hareketler. Banka aktarımı ayrı gösterilir. Kayıt tarihi esas alınır; daha sonra yapılan iade kendi döneminde görünür. Bekleyen bakiye henüz bankaya aktarılmış değildir.</Notice>
      <div className="card"><h3 className="mb-3 font-semibold">İşlem ayrıntıları</h3><Table headers={["Tarih / saat", "İşlem", "Tür / yöntem", "Brüt", "Kesinti", "Net", "Bakiye durumu"]} rows={(showAll ? paymentRows : paymentRows.slice(0, 25)).map((r) => [time(r.created * 1000), r.id, `${typeLabels[r.type] || r.type} / ${r.method}`, eur(r.amount / 100), eur(r.fee / 100), eur(r.net / 100), r.status === "available" ? "Kullanılabilir" : "Bekliyor"])} />
        {paymentRows.length > 25 && <button className="btn-ghost mt-3" onClick={() => setShowAll((v) => !v)}>{showAll ? "İlk 25 hareket" : `Tüm ${num(paymentRows.length)} hareketi göster`}</button>}
        {generatedAt && <p className="mt-3 text-xs text-stone-400">Son okuma: {time(Date.parse(generatedAt))}</p>}{complete && !paymentRows.length && <p className="mt-3 text-sm text-stone-400">Bu dönemde EUR bakiye hareketi yok.</p>}
      </div>
    </section>
  </main>;
}
function KPI({ title, value }: { title: string; value: string }) {
  return <div className="rounded-xl border border-stone-700/60 bg-stone-900/60 p-4"><div className="text-xs text-stone-400">{title}</div><div className="mt-2 text-xl font-semibold sm:text-2xl">{value}</div></div>;
}
function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p role={error ? "alert" : undefined} className={`rounded-xl border p-3 text-xs leading-relaxed ${error ? "border-red-500/50 bg-red-500/10 text-red-200" : "border-stone-700 bg-stone-900/50 text-stone-400"}`}>{children}</p>;
}
function Table({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return <div className="max-h-[32rem] overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-stone-900"><tr>{headers.map((label) => <th key={label} scope="col" className="whitespace-nowrap px-3 py-2 font-medium text-stone-400">{label}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t border-stone-800">{row.map((cell, j) => <td key={j} className="whitespace-nowrap px-3 py-3">{cell}</td>)}</tr>)}</tbody></table></div>;
}
