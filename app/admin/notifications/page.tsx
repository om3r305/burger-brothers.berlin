"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type NotificationKind =
  | "campaign"
  | "offer"
  | "announcement"
  | "coupon"
  | "nearby";

type Audience = "all" | "plz" | "phone";

type RecentItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  sentAt?: string | null;
};

type Stats = {
  activeSubscriptions: number;
  marketingSubscriptions: number;
  orderSubscriptions: number;
};

const KIND_OPTIONS: Array<{
  value: NotificationKind;
  label: string;
  title: string;
  body: string;
}> = [
  {
    value: "campaign",
    label: "Kampanya",
    title: "🌱 Vegane Woche bei Burger Brothers!",
    body: "Entdecken Sie unsere veganen Angebote – nur für kurze Zeit.",
  },
  {
    value: "offer",
    label: "Angebot",
    title: "🔥 Heute ein besonderes Angebot!",
    body: "Jetzt in der Burger-Brothers-App ansehen und direkt bestellen.",
  },
  {
    value: "announcement",
    label: "Duyuru",
    title: "📣 Neu bei Burger Brothers",
    body: "Wir haben Neuigkeiten für Sie. Jetzt in der App ansehen.",
  },
  {
    value: "coupon",
    label: "Kupon duyurusu",
    title: "🎁 Ein Gutschein wartet auf Sie!",
    body: "Öffnen Sie Burger Brothers und entdecken Sie Ihren Vorteil.",
  },
  {
    value: "nearby",
    label: "Yakın teslimat",
    title: "🍔 Wir liefern gerade in Ihre Nähe!",
    body: "Unser Fahrer ist bereits in Ihrer Umgebung. Jetzt direkt bestellen.",
  },
];

function formatDate(value?: string | null) {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isFinite(date.valueOf())
    ? new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date)
    : "–";
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(String(data?.message || data?.error || `HTTP_${response.status}`));
  }
  return data;
}

export default function AdminNotificationsPage() {
  const [stats, setStats] = useState<Stats>({
    activeSubscriptions: 0,
    marketingSubscriptions: 0,
    orderSubscriptions: 0,
  });
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [kind, setKind] = useState<NotificationKind>("campaign");
  const [audience, setAudience] = useState<Audience>("all");
  const [title, setTitle] = useState(KIND_OPTIONS[0].title);
  const [body, setBody] = useState(KIND_OPTIONS[0].body);
  const [url, setUrl] = useState("/menu");
  const [imageUrl, setImageUrl] = useState("");
  const [plz, setPlz] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<"" | "send" | "test">("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"ok" | "error" | "info">("info");

  const selectedKind = useMemo(
    () => KIND_OPTIONS.find((item) => item.value === kind) || KIND_OPTIONS[0],
    [kind],
  );

  const load = useCallback(async () => {
    try {
      const data = await requestJson("/api/admin/notifications");
      setStats(data.stats || {});
      setRecent(Array.isArray(data.recent) ? data.recent : []);
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Veriler yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseKind = (value: NotificationKind) => {
    setKind(value);
    const preset = KIND_OPTIONS.find((item) => item.value === value);
    if (preset) {
      setTitle(preset.title);
      setBody(preset.body);
    }
  };

  const send = async (action: "send" | "test") => {
    if (!title.trim() || !body.trim()) {
      setTone("error");
      setMessage("Başlık ve mesaj zorunlu.");
      return;
    }
    if (audience === "plz" && plz.replace(/\D/g, "").length !== 5) {
      setTone("error");
      setMessage("PLZ hedefi için 5 haneli posta kodu gir.");
      return;
    }
    if (audience === "phone" && phone.replace(/\D/g, "").length < 8) {
      setTone("error");
      setMessage("Telefon hedefi için geçerli numara gir.");
      return;
    }

    setBusy(action);
    setMessage("");
    try {
      const data = await requestJson("/api/admin/notifications", {
        method: "POST",
        body: JSON.stringify({
          action,
          kind,
          audience,
          title,
          body,
          url,
          imageUrl,
          plz,
          phone,
        }),
      });
      setTone("ok");
      setMessage(
        action === "test"
          ? "Test bildirimi bu cihazına gönderildi."
          : `${Number(data.recipientCount || 0)} uygun cihaza bildirim kuyruğa alındı.`,
      );
      window.setTimeout(() => void load(), 1200);
    } catch (error) {
      setTone("error");
      setMessage(
        error instanceof Error ? error.message : "Bildirim gönderilemedi.",
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-3xl border border-stone-800 bg-stone-950/70 p-5 shadow-xl">
        <div className="text-xs font-black uppercase tracking-[0.22em] text-emerald-400">
          Android + iOS Web Push
        </div>
        <h1 className="mt-2 text-3xl font-black text-white">Bildirim Merkezi</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-400">
          Kampanya, Angebot, duyuru, kişisel kupon ve yakın teslimat mesajlarını
          izin vermiş müşterilere gönder. Sipariş durum bildirimleri TV, admin ve
          kurye durum değişikliklerinden otomatik gider.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5">
          <div className="text-sm text-stone-400">Aktif cihaz</div>
          <div className="mt-2 text-4xl font-black text-white">
            {stats.activeSubscriptions || 0}
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5">
          <div className="text-sm text-stone-400">Sipariş bildirimi açık</div>
          <div className="mt-2 text-4xl font-black text-emerald-300">
            {stats.orderSubscriptions || 0}
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5">
          <div className="text-sm text-stone-400">Pazarlama izni</div>
          <div className="mt-2 text-4xl font-black text-amber-300">
            {stats.marketingSubscriptions || 0}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        <div className="rounded-3xl border border-stone-800 bg-stone-950/70 p-5 shadow-xl sm:p-6">
          <h2 className="text-xl font-black text-white">Yeni bildirim</h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-stone-300">
              Bildirim türü
              <select
                value={kind}
                onChange={(event) => chooseKind(event.target.value as NotificationKind)}
                className="mt-2 w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-white"
              >
                {KIND_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-stone-300">
              Hedef kitle
              <select
                value={audience}
                onChange={(event) => setAudience(event.target.value as Audience)}
                className="mt-2 w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-white"
              >
                <option value="all">İzin vermiş tüm uygun müşteriler</option>
                <option value="plz">Belirli PLZ</option>
                <option value="phone">Belirli telefon</option>
              </select>
            </label>
          </div>

          {audience === "plz" ? (
            <label className="mt-4 block text-sm text-stone-300">
              PLZ
              <input
                value={plz}
                onChange={(event) => setPlz(event.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="13405"
                inputMode="numeric"
                className="mt-2 w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-white"
              />
            </label>
          ) : null}

          {audience === "phone" ? (
            <label className="mt-4 block text-sm text-stone-300">
              Telefon
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="0176..."
                inputMode="tel"
                className="mt-2 w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-white"
              />
            </label>
          ) : null}

          <label className="mt-4 block text-sm text-stone-300">
            Başlık
            <input
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-2 w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-white"
            />
          </label>

          <label className="mt-4 block text-sm text-stone-300">
            Mesaj
            <textarea
              value={body}
              maxLength={600}
              rows={5}
              onChange={(event) => setBody(event.target.value)}
              className="mt-2 w-full resize-y rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-white"
            />
          </label>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-stone-300">
              Tıklanınca açılacak sayfa
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="/menu"
                className="mt-2 w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-white"
              />
            </label>
            <label className="block text-sm text-stone-300">
              Görsel URL (opsiyonel)
              <input
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://..."
                className="mt-2 w-full rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-white"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void send("send")}
              className="rounded-xl bg-emerald-400 px-6 py-3 font-black text-black transition hover:bg-emerald-300 disabled:opacity-50"
            >
              {busy === "send" ? "Gönderiliyor…" : "Bildirimi gönder"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void send("test")}
              className="rounded-xl border border-white/15 bg-white/[0.06] px-6 py-3 font-black text-white transition hover:bg-white/[0.1] disabled:opacity-50"
            >
              {busy === "test" ? "Test gönderiliyor…" : "Bu cihaza test gönder"}
            </button>
          </div>

          {message ? (
            <div
              className={[
                "mt-5 rounded-2xl border px-4 py-3 text-sm font-semibold",
                tone === "ok"
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                  : tone === "error"
                    ? "border-red-400/30 bg-red-500/10 text-red-100"
                    : "border-amber-400/30 bg-amber-500/10 text-amber-100",
              ].join(" ")}
            >
              {message}
            </div>
          ) : null}
        </div>

        <aside className="rounded-3xl border border-stone-800 bg-stone-950/70 p-5 shadow-xl sm:p-6">
          <div className="text-sm font-black uppercase tracking-[0.18em] text-stone-500">
            Telefon önizlemesi
          </div>
          <div className="mt-5 rounded-[2rem] border border-white/10 bg-gradient-to-b from-stone-800 to-stone-950 p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icon-kurier-192.png"
                alt=""
                className="h-11 w-11 rounded-xl"
              />
              <div>
                <div className="text-xs text-stone-400">Burger Brothers</div>
                <div className="text-xs text-stone-500">şimdi</div>
              </div>
            </div>
            <div className="mt-4 font-black text-white">{title || selectedKind.title}</div>
            <div className="mt-1 text-sm leading-6 text-stone-300">
              {body || selectedKind.body}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-500/5 p-4 text-xs leading-5 text-stone-400">
            Kampanya, kupon ve yakın teslimat bildirimleri yalnız müşterinin
            ilgili izni açıksa gider. “İkiz mahalle” mesajında başka müşterinin
            adı, siparişi veya kesin adresi gösterilmez.
          </div>
        </aside>
      </section>

      <section className="rounded-3xl border border-stone-800 bg-stone-950/70 p-5 shadow-xl sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-black text-white">Son gönderimler</h2>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-stone-300 hover:bg-white/[0.06]"
          >
            Yenile
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="px-3 py-3">Başlık</th>
                <th className="px-3 py-3">Tür</th>
                <th className="px-3 py-3">Durum</th>
                <th className="px-3 py-3">Hedef</th>
                <th className="px-3 py-3">Başarılı</th>
                <th className="px-3 py-3">Tarih</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((item) => (
                <tr key={item.id} className="border-t border-white/5 text-stone-300">
                  <td className="px-3 py-3 font-bold text-white">{item.title}</td>
                  <td className="px-3 py-3">{item.kind}</td>
                  <td className="px-3 py-3">{item.status}</td>
                  <td className="px-3 py-3">{item.recipientCount}</td>
                  <td className="px-3 py-3 text-emerald-300">
                    {item.successCount}
                    {item.failureCount ? ` / ${item.failureCount} hata` : ""}
                  </td>
                  <td className="px-3 py-3">{formatDate(item.sentAt || item.createdAt)}</td>
                </tr>
              ))}
              {!recent.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-stone-500">
                    Henüz gönderim yok.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
