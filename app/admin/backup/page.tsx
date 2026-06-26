// app/admin/backup/page.tsx
"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ChangeEvent } from "react";

type ApiResult = {
  ok?: boolean;
  source?: string;
  error?: string;
  message?: string;
  mode?: string;
  counts?: Record<string, number>;
  imported?: Record<string, number>;
  previewCounts?: Record<string, number>;
  rebuilt?: {
    orders?: number;
    daily?: number;
    monthly?: number;
  } | null;
  matched?: number;
  archived?: number;
  archivedAt?: string | null;
  range?: {
    from?: string;
    to?: string;
    daysOld?: number;
    cutoff?: string;
  };
  startedAt?: string;
  finishedAt?: string;
  [key: string]: any;
};

const DEFAULT_SECTIONS = "all";
const DEFAULT_DAYS_OLD = 90;

function nowInputValue() {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");

  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());

  return `${yyyy}-${mm}-${dd}`;
}

function dateYearsAgoInputValue(years: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  date.setHours(0, 0, 0, 0);

  const pad = (n: number) => String(n).padStart(2, "0");

  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());

  return `${yyyy}-${mm}-${dd}`;
}

function toIsoDayStart(value: string) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.valueOf())) return null;

  return date.toISOString();
}

function toIsoDayEnd(value: string) {
  if (!value) return null;

  const date = new Date(`${value}T23:59:59.999`);
  if (!Number.isFinite(date.valueOf())) return null;

  return date.toISOString();
}

function prettyJson(value: any) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function downloadText(filename: string, text: string, type = "application/json;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

function safeFileNamePart(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function resultTitle(result: ApiResult | null) {
  if (!result) return "Keine Aktion ausgeführt.";

  if (result.ok === false) {
    return result.error || "Fehler";
  }

  if (result.mode === "preview") return "Vorschau erfolgreich.";
  if (result.mode === "archive") return "Archivierung erfolgreich.";
  if (result.mode === "import") return "Import erfolgreich.";
  if (result.rebuilt) return "Summary rebuild erfolgreich.";

  return "Aktion erfolgreich.";
}

export default function AdminBackupPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sections, setSections] = useState(DEFAULT_SECTIONS);
  const [from, setFrom] = useState(dateYearsAgoInputValue(5));
  const [to, setTo] = useState(nowInputValue());
  const [includeArchived, setIncludeArchived] = useState(true);

  const [daysOld, setDaysOld] = useState(String(DEFAULT_DAYS_OLD));

  const [backupText, setBackupText] = useState("");
  const [importSections, setImportSections] = useState("products,settings");
  const [confirmImport, setConfirmImport] = useState(false);

  const [loading, setLoading] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ApiResult | null>(null);

  const rangeParams = useMemo(() => {
    const params = new URLSearchParams();

    const fromIso = toIsoDayStart(from);
    const toIso = toIsoDayEnd(to);

    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);

    return params;
  }, [from, to]);

  async function runSummaryRebuild() {
    setLoading("summary");

    try {
      const params = new URLSearchParams(rangeParams);
      params.set("rebuild", "1");

      const res = await fetch(`/api/admin/stats/summary?${params.toString()}`, {
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      const json = await res.json().catch(() => ({}));

      setLastResult(json);
    } catch (error: any) {
      setLastResult({
        ok: false,
        error: error?.message || "SUMMARY_REBUILD_FAILED",
      });
    } finally {
      setLoading(null);
    }
  }

  async function previewArchive() {
    setLoading("archive-preview");

    try {
      const params = new URLSearchParams();
      params.set("daysOld", String(Math.max(1, Math.trunc(Number(daysOld) || DEFAULT_DAYS_OLD))));

      const res = await fetch(`/api/admin/maintenance/archive-orders?${params.toString()}`, {
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      const json = await res.json().catch(() => ({}));

      setLastResult(json);
    } catch (error: any) {
      setLastResult({
        ok: false,
        error: error?.message || "ARCHIVE_PREVIEW_FAILED",
      });
    } finally {
      setLoading(null);
    }
  }

  async function runArchive() {
    const ok = window.confirm(
      `${daysOld || DEFAULT_DAYS_OLD} günden eski done/cancelled siparişlere archivedAt basılacak.\n\nSilme yok, sadece aktif listeden çıkarma var.\n\nDevam edelim mi?`,
    );

    if (!ok) return;

    setLoading("archive-run");

    try {
      const res = await fetch("/api/admin/maintenance/archive-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          daysOld: Math.max(1, Math.trunc(Number(daysOld) || DEFAULT_DAYS_OLD)),
        }),
      });

      const json = await res.json().catch(() => ({}));

      setLastResult(json);
    } catch (error: any) {
      setLastResult({
        ok: false,
        error: error?.message || "ARCHIVE_RUN_FAILED",
      });
    } finally {
      setLoading(null);
    }
  }

  async function downloadBackup() {
    setLoading("backup-export");

    try {
      const params = new URLSearchParams(rangeParams);
      params.set("sections", sections || "all");

      if (includeArchived) {
        params.set("includeArchived", "1");
      }

      params.set("inline", "1");

      const res = await fetch(`/api/admin/backup/export?${params.toString()}`, {
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      const text = await res.text();

      let json: any = null;

      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      if (!res.ok || json?.ok === false) {
        setLastResult(
          json || {
            ok: false,
            error: `BACKUP_EXPORT_${res.status}`,
          },
        );
        return;
      }

      const tenantSlug = safeFileNamePart(json?.tenant?.slug || "burger-brothers");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `${tenantSlug}-backup-${stamp}.json`;

      downloadText(fileName, JSON.stringify(json, null, 2));

      setLastResult({
        ok: true,
        source: "db",
        message: "Backup indirildi.",
        fileName,
        counts: json?.counts || {},
        range: json?.range,
        sections: json?.sections,
      });
    } catch (error: any) {
      setLastResult({
        ok: false,
        error: error?.message || "BACKUP_EXPORT_FAILED",
      });
    } finally {
      setLoading(null);
    }
  }

  async function loadBackupFile(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      JSON.parse(text);
      setBackupText(text);

      setLastResult({
        ok: true,
        message: `Backup-Datei geladen: ${file.name}`,
      });
    } catch (error: any) {
      setBackupText("");
      setLastResult({
        ok: false,
        error: "Ungültige JSON-Datei.",
        detail: error?.message || "",
      });
    } finally {
      ev.target.value = "";
    }
  }

  async function runImport() {
    if (!backupText.trim()) {
      setLastResult({
        ok: false,
        error: "Önce eine Backup JSON-Datei auswählen oder JSON einfügen.",
      });
      return;
    }

    let backup: any = null;

    try {
      backup = JSON.parse(backupText);
    } catch (error: any) {
      setLastResult({
        ok: false,
        error: "Backup JSON ist ungültig.",
        detail: error?.message || "",
      });
      return;
    }

    if (confirmImport) {
      const ok = window.confirm(
        "Bu import gerçek yazma işlemi yapacak.\n\nMevcut kayıt varsa günceller, yoksa ekler. Silme yapmaz.\n\nDevam edelim mi?",
      );

      if (!ok) return;
    }

    setLoading(confirmImport ? "backup-import" : "backup-import-preview");

    try {
      const res = await fetch("/api/admin/backup/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          backup,
          sections: importSections || "all",
          confirm: confirmImport,
          dryRun: !confirmImport,
        }),
      });

      const json = await res.json().catch(() => ({}));

      setLastResult(json);
    } catch (error: any) {
      setLastResult({
        ok: false,
        error: error?.message || "BACKUP_IMPORT_FAILED",
      });
    } finally {
      setLoading(null);
    }
  }

  const disabled = Boolean(loading);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Backup & Wartung</h1>
          <div className="mt-1 text-sm text-stone-400">
            Backup, Import, Archivierung und Summary-Rebuild.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin" className="btn-ghost">
            ← Admin
          </Link>
          <Link href="/admin/stats" className="btn-ghost">
            Statistiken
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
        <section className="grid gap-6">
          <div className="card">
            <div className="mb-3 text-lg font-medium">Zeitraum</div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block text-stone-300/80">Von</span>
                <input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-stone-300/80">Bis</span>
                <input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                />
              </label>

              <div className="flex items-end gap-2">
                <button
                  className="btn-ghost w-full"
                  disabled={disabled}
                  onClick={() => {
                    setFrom(dateYearsAgoInputValue(1));
                    setTo(nowInputValue());
                  }}
                >
                  1 Jahr
                </button>
                <button
                  className="btn-ghost w-full"
                  disabled={disabled}
                  onClick={() => {
                    setFrom(dateYearsAgoInputValue(5));
                    setTo(nowInputValue());
                  }}
                >
                  5 Jahre
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-lg font-medium">Backup herunterladen</div>
                <div className="text-sm text-stone-400">
                  JSON Export für Orders, Produkte, Settings, Kunden, Kampagnen, Coupons und Summaries.
                </div>
              </div>
              <button className="card-cta" disabled={disabled} onClick={downloadBackup}>
                {loading === "backup-export" ? "Wird erstellt…" : "Backup herunterladen"}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-stone-300/80">Sections</span>
                <input
                  value={sections}
                  onChange={(event) => setSections(event.target.value)}
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  placeholder="all oder orders,products,settings"
                />
              </label>

              <label className="flex items-center gap-2 self-end rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(event) => setIncludeArchived(event.target.checked)}
                />
                Archivierte Bestellungen einschließen
              </label>
            </div>

            <div className="mt-3 text-xs text-stone-400">
              Beispiele: <code>all</code>, <code>orders</code>,{" "}
              <code>products,settings</code>, <code>orders,customers,summaries</code>
            </div>
          </div>

          <div className="card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-lg font-medium">Summary rebuild</div>
                <div className="text-sm text-stone-400">
                  Erstellt DailySalesSummary und MonthlySalesSummary aus vorhandenen Orders neu.
                </div>
              </div>
              <button className="card-cta" disabled={disabled} onClick={runSummaryRebuild}>
                {loading === "summary" ? "Läuft…" : "Summary rebuild starten"}
              </button>
            </div>

            <div className="mt-3 rounded-lg border border-stone-700/60 bg-stone-950 p-3 text-sm text-stone-300">
              Das brauchst du für schnelle Jahresberichte, ohne jedes Mal alle Einzelbestellungen zu berechnen.
            </div>
          </div>

          <div className="card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-lg font-medium">Alte Orders archivieren</div>
                <div className="text-sm text-stone-400">
                  Setzt archivedAt auf alte done/cancelled Orders. Es wird nichts gelöscht.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" disabled={disabled} onClick={previewArchive}>
                  {loading === "archive-preview" ? "Prüft…" : "Vorschau"}
                </button>
                <button className="card-cta" disabled={disabled} onClick={runArchive}>
                  {loading === "archive-run" ? "Archiviert…" : "Archiv ausführen"}
                </button>
              </div>
            </div>

            <div className="mt-4 max-w-xs">
              <label className="block text-sm">
                <span className="mb-1 block text-stone-300/80">Älter als Tage</span>
                <input
                  type="number"
                  min={1}
                  value={daysOld}
                  onChange={(event) => setDaysOld(event.target.value)}
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                />
              </label>
            </div>

            <div className="mt-3 rounded-lg border border-stone-700/60 bg-stone-950 p-3 text-sm text-stone-300">
              Empfehlung: 90 Tage. Aktive TV/Admin-Listen bleiben dadurch schnell, Berichte können mit includeArchived weiter alte Daten lesen.
            </div>
          </div>

          <div className="card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-lg font-medium">Backup importieren</div>
                <div className="text-sm text-stone-400">
                  Standard ist Dry-run. Real Import nur mit Bestätigung.
                </div>
              </div>

              <button className="card-cta" disabled={disabled} onClick={runImport}>
                {loading === "backup-import" || loading === "backup-import-preview"
                  ? "Import läuft…"
                  : confirmImport
                    ? "Import ausführen"
                    : "Dry-run prüfen"}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-stone-300/80">Import Sections</span>
                <input
                  value={importSections}
                  onChange={(event) => setImportSections(event.target.value)}
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  placeholder="products,settings"
                />
              </label>

              <label className="flex items-center gap-2 self-end rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmImport}
                  onChange={(event) => setConfirmImport(event.target.checked)}
                />
                Real Import bestätigen
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn-ghost"
                type="button"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
              >
                JSON-Datei auswählen
              </button>
              <button
                className="btn-ghost"
                type="button"
                disabled={disabled || !backupText}
                onClick={() => setBackupText("")}
              >
                JSON leeren
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={loadBackupFile}
              />
            </div>

            <textarea
              value={backupText}
              onChange={(event) => setBackupText(event.target.value)}
              rows={10}
              className="mt-3 w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 font-mono text-xs outline-none"
              placeholder="Backup JSON hier einfügen oder Datei auswählen…"
            />

            <div className="mt-3 text-xs text-stone-400">
              Sicher: Import löscht keine Daten. Bestehende IDs/SKUs/Codes werden aktualisiert, fehlende werden ergänzt.
            </div>
          </div>
        </section>

        <aside className="h-fit rounded-xl border border-stone-700/60 bg-stone-900/60 p-4 xl:sticky xl:top-4">
          <div className="mb-2 text-lg font-medium">Letztes Ergebnis</div>

          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
              lastResult?.ok === false
                ? "border-red-700/60 bg-red-950/40 text-red-100"
                : "border-stone-700/60 bg-stone-950 text-stone-200"
            }`}
          >
            {resultTitle(lastResult)}
          </div>

          <pre className="max-h-[680px] overflow-auto rounded-lg border border-stone-700/60 bg-black p-3 text-xs text-stone-200">
            {prettyJson(lastResult || { info: "Noch keine Aktion ausgeführt." })}
          </pre>
        </aside>
      </div>
    </main>
  );
}