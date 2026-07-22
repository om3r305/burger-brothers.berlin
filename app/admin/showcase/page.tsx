"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ShowcaseStage from "@/components/showcase/ShowcaseStage";
import {
  createDefaultShowcaseDocument,
  normalizeShowcaseDocument,
} from "@/lib/showcase/config";
import {
  availableShowcaseCategories,
  buildShowcaseMenuPages,
  effectiveShowcaseSceneDuration,
  selectedProductsForScene,
  showcaseCategoryLabel,
} from "@/lib/showcase/runtime";
import type {
  ShowcaseBranding,
  ShowcaseCampaign,
  ShowcaseDocument,
  ShowcaseMediaItem,
  ShowcaseProduct,
  ShowcasePreviewAspect,
  ShowcaseScene,
  ShowcaseSceneType,
  ShowcaseSnapshot,
} from "@/lib/showcase/types";

const TYPE_LABELS: Record<ShowcaseSceneType, string> = {
  hero: "Giriş ekranı",
  video: "Video",
  product: "Ürün akışı",
  menu: "Dijital menü",
  campaign: "Kampanya",
  image: "Görsel",
  qr: "QR kod",
  message: "Metin / Duyuru",
};

const TYPE_ICONS: Record<ShowcaseSceneType, string> = {
  hero: "🔥",
  video: "🎬",
  product: "🍔",
  menu: "📋",
  campaign: "🏷️",
  image: "🖼️",
  qr: "📱",
  message: "💬",
};

type StorageState = {
  configured: boolean;
  provider: "cloudinary";
  cloudName: string;
  maxUploadBytes: number;
};

type AdminPayload = {
  draft: ShowcaseDocument;
  published: ShowcaseDocument;
  media: ShowcaseMediaItem[];
  products: ShowcaseProduct[];
  campaigns: ShowcaseCampaign[];
  branding: ShowcaseBranding;
  storage: StorageState;
};

function uid(prefix = "scene") {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function formatBytes(value: number) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function localDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}

function isoDate(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
}

function newScene(type: ShowcaseSceneType, document: ShowcaseDocument): ShowcaseScene {
  const common = {
    id: uid(),
    type,
    name: TYPE_LABELS[type],
    enabled: true,
    durationSeconds: document.settings.defaultDurationSeconds,
    transition: "fade" as const,
    accent: "#ff9d2e",
    fit: "cover" as const,
    showLogo: true,
    showQr: type !== "video",
    qrLabel: document.settings.qrLabel,
    showPrice: true,
    muted: true,
  };

  if (type === "hero") {
    return {
      ...common,
      title: "BURGER BROTHERS BERLIN",
      subtitle: "Frisch gegrillt. Direkt bestellt.",
      badge: "BERLIN-TEGEL",
    };
  }
  if (type === "video") {
    return {
      ...common,
      name: "Yeni video",
      title: "Frisch für Sie zubereitet",
      subtitle: "Burger Brothers Berlin",
      showQr: false,
    };
  }
  if (type === "product") {
    return {
      ...common,
      name: "Ürün akışı",
      title: "BURGER BROTHERS EMPFIEHLT",
      subtitle: "Frisch zubereitet und voller Geschmack.",
      productIds: [],
      productSeconds: 12,
      productImageFit: "contain",
      productImageScale: 82,
      productImageX: 0,
      productImageY: 0,
      showLogo: false,
      showQr: false,
      fit: "contain",
    };
  }
  if (type === "menu") {
    return {
      ...common,
      name: "Dijital menü",
      title: "UNSERE SPEISEKARTE",
      subtitle: "Frisch zubereitet. Direkt online bestellen.",
      menuCategories: [],
      menuItemsPerPage: 8,
      menuPageSeconds: 12,
      menuColumns: 2,
      menuShowDescriptions: false,
      menuShowImages: true,
      menuImageSize: 58,
      showLogo: false,
      showQr: false,
    };
  }
  if (type === "campaign") {
    return {
      ...common,
      name: "Kampanya",
      title: "AKTUELLE AKTION",
      subtitle: "Nur für kurze Zeit",
      badge: "LIMITIERTE AKTION",
    };
  }
  if (type === "image") {
    return { ...common, name: "Görsel", title: "Burger Brothers Berlin", showQr: false };
  }
  if (type === "qr") {
    return {
      ...common,
      name: "Online sipariş",
      title: "JETZT ONLINE BESTELLEN",
      subtitle: "QR-Code scannen und direkt zur Speisekarte",
    };
  }
  return {
    ...common,
    name: "Duyuru",
    badge: "WICHTIGE INFORMATION",
    title: "WICHTIGE MITTEILUNG",
    subtitle: "Aktuelle Informationen von Burger Brothers Berlin.",
    body: "Öffnungszeiten, Lieferhinweise oder eine besondere Ankündigung hier eintragen.",
    showQr: false,
  };
}

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP_${response.status}`);
  }
  return data;
}

function signalShowcasePublished(version?: string) {
  const payload = {
    version: String(version || ""),
    at: Date.now(),
  };

  try {
    const channel = new BroadcastChannel("bb_showcase_live_v1");
    channel.postMessage(payload);
    channel.close();
  } catch {}

  try {
    localStorage.setItem("bb_showcase_publish_ping", JSON.stringify(payload));
  } catch {}
}

async function inspectFile(file: File): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("video/")) {
      return await new Promise<{ width?: number; height?: number; durationSeconds?: number }>((resolve) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () =>
          resolve({
            width: video.videoWidth || undefined,
            height: video.videoHeight || undefined,
            durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : undefined,
          });
        video.onerror = () => resolve({});
        video.src = url;
      });
    }

    if (file.type.startsWith("image/")) {
      return await new Promise<{ width?: number; height?: number }>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve({});
        image.src = url;
      });
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  return {};
}

function uploadCloudinaryWithProgress(
  url: string,
  fields: Record<string, string | number>,
  file: File,
  onProgress: (value: number) => void,
) {
  return new Promise<Record<string, any>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
    form.append("file", file);

    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const response = (() => {
        try {
          return JSON.parse(xhr.responseText || "{}");
        } catch {
          return {};
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300 && response?.secure_url) resolve(response);
      else reject(new Error(response?.error?.message || `CLOUDINARY_UPLOAD_HTTP_${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("CLOUDINARY_UPLOAD_NETWORK_ERROR"));
    xhr.onabort = () => reject(new Error("CLOUDINARY_UPLOAD_ABORTED"));
    xhr.send(form);
  });
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-stone-200">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-stone-700 bg-stone-950/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20";

export default function ShowcaseAdminPage() {
  const [data, setData] = useState<AdminPayload | null>(null);
  const [draft, setDraft] = useState<ShowcaseDocument | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewAspect, setPreviewAspect] = useState<ShowcasePreviewAspect>("landscape");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setError("");
    try {
      const payload = (await jsonFetch("/api/admin/showcase")) as AdminPayload;
      setData(payload);
      setDraft(payload.draft);
      setSelectedId((current) => current || payload.draft.scenes[0]?.id || "");
    } catch (loadError: any) {
      setError(loadError?.message || "Vitrin ekranı yüklenemedi.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const refreshLiveSources = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = (await jsonFetch("/api/admin/showcase")) as AdminPayload;
      setData((current) =>
        current
          ? {
              ...current,
              published: payload.published,
              media: payload.media,
              products: payload.products,
              campaigns: payload.campaigns,
              branding: payload.branding,
              storage: payload.storage,
            }
          : payload,
      );
      setMessage(`Web sitesi verileri yenilendi. Aktif tema: ${payload.branding.themeId}`);
    } catch (refreshError: any) {
      setError(refreshError?.message || "Web sitesi tema ve ürün verileri yenilenemedi.");
    } finally {
      setBusy(false);
    }
  };

  const selectedIndex = useMemo(
    () => draft?.scenes.findIndex((scene) => scene.id === selectedId) ?? -1,
    [draft?.scenes, selectedId],
  );
  const selected = selectedIndex >= 0 ? draft?.scenes[selectedIndex] || null : null;

  const selectedProducts = useMemo(
    () => (selected && data ? selectedProductsForScene(selected, data.products) : []),
    [selected, data],
  );
  const availableCategories = useMemo(
    () => (data ? availableShowcaseCategories(data.products) : []),
    [data],
  );
  const selectedMenuPages = useMemo(
    () => (selected && data ? buildShowcaseMenuPages(selected, data.products) : []),
    [selected, data],
  );

  const previewSnapshot = useMemo<ShowcaseSnapshot | null>(() => {
    if (!data || !draft) return null;
    return {
      ok: true,
      source: "db",
      generatedAt: new Date().toISOString(),
      document: draft,
      products: data.products,
      campaigns: data.campaigns,
      branding: data.branding,
    };
  }, [data, draft]);

  const updateDocument = (patch: Partial<ShowcaseDocument>) => {
    setDraft((current) => (current ? { ...current, ...patch, updatedAt: new Date().toISOString() } : current));
  };

  const updateSettings = (patch: Partial<ShowcaseDocument["settings"]>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            updatedAt: new Date().toISOString(),
            settings: { ...current.settings, ...patch },
          }
        : current,
    );
  };

  const updateScene = (patch: Partial<ShowcaseScene>) => {
    if (!selectedId) return;
    setDraft((current) =>
      current
        ? {
            ...current,
            updatedAt: new Date().toISOString(),
            scenes: current.scenes.map((scene) =>
              scene.id === selectedId ? { ...scene, ...patch } : scene,
            ),
          }
        : current,
    );
  };

  const changeSceneType = (type: ShowcaseSceneType) => {
    if (!draft || !selected) return;
    const defaults = newScene(type, draft);
    updateScene({
      type,
      name: defaults.name,
      title: defaults.title,
      subtitle: defaults.subtitle,
      body: defaults.body,
      badge: defaults.badge,
      qrLabel: defaults.qrLabel,
      showLogo: defaults.showLogo,
      showQr: defaults.showQr,
      showPrice: defaults.showPrice,
      fit: defaults.fit,
      productIds: defaults.productIds,
      productId: defaults.productId,
      productSeconds: defaults.productSeconds,
      productImageFit: defaults.productImageFit,
      productImageScale: defaults.productImageScale,
      productImageX: defaults.productImageX,
      productImageY: defaults.productImageY,
      menuCategories: defaults.menuCategories,
      menuItemsPerPage: defaults.menuItemsPerPage,
      menuPageSeconds: defaults.menuPageSeconds,
      menuColumns: defaults.menuColumns,
      menuShowDescriptions: defaults.menuShowDescriptions,
      menuShowImages: defaults.menuShowImages,
      menuImageSize: defaults.menuImageSize,
    });
  };

  const setProductIds = (ids: string[]) => {
    const clean = Array.from(new Set(ids.map(String).filter(Boolean))).slice(0, 50);
    updateScene({ productIds: clean, productId: clean[0] || undefined });
  };

  const addProductToScene = (productId: string) => {
    if (!productId || !selected) return;
    const ids = Array.isArray(selected.productIds)
      ? selected.productIds
      : selected.productId
        ? [selected.productId]
        : [];
    if (ids.includes(productId)) return;
    setProductIds([...ids, productId]);
  };

  const removeProductFromScene = (productId: string) => {
    if (!selected) return;
    const ids = Array.isArray(selected.productIds)
      ? selected.productIds
      : selected.productId
        ? [selected.productId]
        : [];
    setProductIds(ids.filter((id) => id !== productId));
  };

  const moveProductInScene = (productId: string, direction: -1 | 1) => {
    if (!selected) return;
    const ids = Array.isArray(selected.productIds)
      ? [...selected.productIds]
      : selected.productId
        ? [selected.productId]
        : [];
    const index = ids.indexOf(productId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setProductIds(ids);
  };

  const toggleMenuCategory = (category: string) => {
    if (!selected) return;
    const current = Array.isArray(selected.menuCategories) ? selected.menuCategories : [];
    updateScene({
      menuCategories: current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    });
  };

  const setOnlyMenuCategory = (category: string) => {
    updateScene({ menuCategories: [category] });
    setMessage(`Dijital menü yalnızca “${showcaseCategoryLabel(category, "tr")}” grubunu gösterecek.`);
  };

  const clearMenuCategories = () => {
    updateScene({ menuCategories: [] });
    setMessage("Dijital menü grup seçimi temizlendi.");
  };

  const addScene = (type: ShowcaseSceneType) => {
    if (!draft) return;
    const scene = newScene(type, draft);
    setDraft({ ...draft, scenes: [...draft.scenes, scene], updatedAt: new Date().toISOString() });
    setSelectedId(scene.id);
  };

  const deleteScene = () => {
    if (!draft || !selected) return;
    if (draft.scenes.length <= 1) {
      setError("En az bir sahne kalmalıdır.");
      return;
    }
    if (!window.confirm(`“${selected.name}” gerçekten silinsin mi?`)) return;
    const next = draft.scenes.filter((scene) => scene.id !== selected.id);
    setDraft({ ...draft, scenes: next, updatedAt: new Date().toISOString() });
    setSelectedId(next[Math.max(0, selectedIndex - 1)]?.id || next[0]?.id || "");
  };

  const duplicateScene = () => {
    if (!draft || !selected) return;
    const copy = { ...selected, id: uid(), name: `${selected.name} Kopyası` };
    const next = [...draft.scenes];
    next.splice(selectedIndex + 1, 0, copy);
    setDraft({ ...draft, scenes: next, updatedAt: new Date().toISOString() });
    setSelectedId(copy.id);
  };

  const moveScene = (direction: -1 | 1) => {
    if (!draft || selectedIndex < 0) return;
    const target = selectedIndex + direction;
    if (target < 0 || target >= draft.scenes.length) return;
    const next = [...draft.scenes];
    [next[selectedIndex], next[target]] = [next[target], next[selectedIndex]];
    setDraft({ ...draft, scenes: next, updatedAt: new Date().toISOString() });
  };

  const validateDraft = (document: ShowcaseDocument) => {
    const emptyMenu = document.scenes.find(
      (scene) => scene.enabled && scene.type === "menu" && !(scene.menuCategories || []).length,
    );
    if (emptyMenu) {
      setSelectedId(emptyMenu.id);
      setError(`“${emptyMenu.name}” sahnesinde en az bir dijital menü grubu seçmelisin.`);
      return false;
    }
    return true;
  };

  const saveDraft = async () => {
    if (!draft || !validateDraft(draft)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await jsonFetch("/api/admin/showcase", {
        method: "PUT",
        body: JSON.stringify({ document: draft }),
      });
      setDraft(response.draft);
      setMessage("Taslak kaydedildi. TV ekranındaki yayın henüz değiştirilmedi.");
    } catch (saveError: any) {
      setError(saveError?.message || "Taslak kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!draft || !validateDraft(draft)) return;
    if (!window.confirm("Bu sürüm şimdi TV vitrin ekranında yayınlansın mı?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await jsonFetch("/api/admin/showcase", {
        method: "POST",
        body: JSON.stringify({ action: "publish", document: draft }),
      });
      setDraft(response.draft);
      setData((current) => (current ? { ...current, draft: response.draft, published: response.published } : current));
      signalShowcasePublished(response.published?.version);
      setMessage("Yayınlandı. Açık Showcase ekranları 2–5 saniye içinde yenilenmeden güncellenecek.");
    } catch (publishError: any) {
      setError(publishError?.message || "Yayınlama başarısız oldu.");
    } finally {
      setBusy(false);
    }
  };

  const restorePublished = async () => {
    if (!window.confirm("Taslak silinip son yayınlanan sürüm yüklensin mi?")) return;
    setBusy(true);
    try {
      const response = await jsonFetch("/api/admin/showcase", {
        method: "POST",
        body: JSON.stringify({ action: "restorePublished" }),
      });
      setDraft(response.draft);
      setSelectedId(response.draft.scenes[0]?.id || "");
      setMessage("Son yayınlanan sürüm taslak olarak yüklendi.");
    } catch (restoreError: any) {
      setError(restoreError?.message || "Geri yükleme başarısız oldu.");
    } finally {
      setBusy(false);
    }
  };

  const uploadMedia = async (file: File) => {
    const currentScene = selected;
    if (!currentScene) return;
    if (!data?.storage?.configured) {
      setError("Cloudinary henüz Vercel üzerinde ayarlanmadı.");
      return;
    }
    if (file.size > data.storage.maxUploadBytes) {
      setError(`Dosya çok büyük. En fazla ${formatBytes(data.storage.maxUploadBytes)} yükleyebilirsin.`);
      return;
    }
    setUploadProgress(0);
    setError("");
    setMessage("");

    try {
      const signed = await jsonFetch("/api/admin/showcase/media", {
        method: "POST",
        body: JSON.stringify({
          action: "sign",
          name: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      });
      const upload = await uploadCloudinaryWithProgress(
        signed.uploadUrl,
        signed.fields,
        file,
        setUploadProgress,
      );
      const metadata = await inspectFile(file);
      const registered = await jsonFetch("/api/admin/showcase/media", {
        method: "POST",
        body: JSON.stringify({
          action: "register",
          name: file.name,
          mimeType: file.type,
          size: file.size,
          upload,
          ...metadata,
        }),
      });
      setData((current) => (current ? { ...current, media: registered.media } : current));
      updateScene({
        mediaUrl: registered.item.url,
        durationSeconds: metadata.durationSeconds
          ? Math.max(5, Math.ceil(metadata.durationSeconds))
          : currentScene.durationSeconds,
      });
      setMessage(`${file.name} yüklendi ve seçili sahneye atandı.`);
    } catch (uploadError: any) {
      setError(
        uploadError?.message === "CLOUDINARY_UPLOAD_NETWORK_ERROR"
          ? "Yükleme başarısız oldu. İnternet bağlantısını kontrol edip yeniden dene."
          : uploadError?.message || "Yükleme başarısız oldu.",
      );
    } finally {
      setUploadProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const deleteMedia = async (item: ShowcaseMediaItem) => {
    if (!window.confirm(`${item.name} Cloudinary üzerinden kalıcı olarak silinsin mi?`)) return;
    try {
      const response = await jsonFetch("/api/admin/showcase/media", {
        method: "DELETE",
        body: JSON.stringify({ id: item.id }),
      });
      setData((current) => (current ? { ...current, media: response.media } : current));
      setMessage("Medya dosyası silindi.");
    } catch (deleteError: any) {
      setError(
        deleteError?.message === "MEDIA_IS_IN_USE"
          ? "Bu dosya bir taslakta veya yayınlanan sürümde hâlâ kullanılıyor. Önce ilgili sahnelerden kaldır."
          : deleteError?.message || "Dosya silinemedi.",
      );
    }
  };

  if (!draft || !data || !selected || !previewSnapshot) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-stone-700 border-t-orange-400" />
          <p className="mt-4 text-stone-400">Vitrin ekranı yükleniyor…</p>
          {error ? <p className="mt-3 text-red-400">{error}</p> : null}
        </div>
      </div>
    );
  }

  const selectedProduct = selectedProducts[0] || null;
  const selectedSceneDuration = effectiveShowcaseSceneDuration(selected, previewSnapshot);

  return (
    <div className="mx-auto max-w-[1900px] space-y-5">
      <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-800 bg-stone-900/60 p-4 shadow-xl">
        <div>
          <div className="text-xs font-bold uppercase tracking-[.2em] text-orange-400">Dijital Vitrin</div>
          <h1 className="mt-1 text-2xl font-black text-white">Vitrin Yönetimi</h1>
          <p className="text-sm text-stone-400">Sahneleri hazırla, canlı önizle ve kontrol ettikten sonra yayınla.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={() => void refreshLiveSources()}
            disabled={busy}
            className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-100 hover:bg-sky-500/20 disabled:opacity-50"
          >
            Site verilerini yenile
          </button>
          <a
            href="/showcase"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-stone-700 bg-stone-950 px-4 py-2.5 text-sm font-semibold hover:border-stone-500"
          >
            TV ekranını aç ↗
          </a>
          <button onClick={restorePublished} disabled={busy} className="rounded-xl border border-stone-700 px-4 py-2.5 text-sm font-semibold hover:bg-stone-800 disabled:opacity-50">
            Son yayınlananı yükle
          </button>
          <button onClick={saveDraft} disabled={busy} className="rounded-xl border border-orange-500/50 bg-orange-500/10 px-4 py-2.5 text-sm font-bold text-orange-200 hover:bg-orange-500/20 disabled:opacity-50">
            Taslağı kaydet
          </button>
          <button onClick={publish} disabled={busy} className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-black text-black shadow-lg shadow-orange-500/20 hover:bg-orange-400 disabled:opacity-50">
            Yayınla
          </button>
        </div>
      </header>

      {message ? <div className="rounded-xl border border-emerald-700/50 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}
      {error ? <div className="rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)_minmax(520px,1.15fr)]">
        <aside className="space-y-4 rounded-2xl border border-stone-800 bg-stone-900/55 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-black">Sahneler</h2>
              <p className="text-xs text-stone-500">{draft.scenes.length} sahne</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-stone-400">
              Aktif
              <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDocument({ enabled: event.target.checked })} />
            </label>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(TYPE_LABELS) as ShowcaseSceneType[]).map((type) => (
              <button
                key={type}
                onClick={() => addScene(type)}
                title={`${TYPE_LABELS[type]} ekle`}
                className="rounded-xl border border-stone-800 bg-stone-950 px-2 py-2 text-lg hover:border-orange-500/60 hover:bg-stone-900"
              >
                {TYPE_ICONS[type]}
              </button>
            ))}
          </div>

          <div className="max-h-[690px] space-y-2 overflow-y-auto pr-1">
            {draft.scenes.map((scene, index) => (
              <button
                key={scene.id}
                onClick={() => setSelectedId(scene.id)}
                className={[
                  "w-full rounded-xl border p-3 text-left transition",
                  scene.id === selected.id
                    ? "border-orange-500 bg-orange-500/10"
                    : "border-stone-800 bg-stone-950/70 hover:border-stone-600",
                ].join(" ")}
              >
                <div className="flex items-start gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-stone-800 text-base">{TYPE_ICONS[scene.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{index + 1}. {scene.name}</span>
                    <span className="mt-1 block text-xs text-stone-500">{TYPE_LABELS[scene.type]} · {effectiveShowcaseSceneDuration(scene, previewSnapshot)} sn.</span>
                  </span>
                  <span className={`mt-1 h-2.5 w-2.5 rounded-full ${scene.enabled ? "bg-emerald-400" : "bg-stone-600"}`} />
                </div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-2 border-t border-stone-800 pt-3">
            <button onClick={() => moveScene(-1)} className="rounded-lg bg-stone-800 px-2 py-2 text-sm hover:bg-stone-700">↑</button>
            <button onClick={() => moveScene(1)} className="rounded-lg bg-stone-800 px-2 py-2 text-sm hover:bg-stone-700">↓</button>
            <button onClick={duplicateScene} className="rounded-lg bg-stone-800 px-2 py-2 text-sm hover:bg-stone-700">Kopyala</button>
            <button onClick={deleteScene} className="rounded-lg bg-red-950/70 px-2 py-2 text-sm text-red-300 hover:bg-red-900">Sil</button>
          </div>
        </aside>

        <main className="space-y-4 rounded-2xl border border-stone-800 bg-stone-900/55 p-4">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-800 pb-4">
            <div>
              <h2 className="font-black">Sahneyi düzenle</h2>
              <p className="text-xs text-stone-500">{TYPE_LABELS[selected.type]}</p>
            </div>
            <label className="ml-auto flex items-center gap-2 text-sm font-semibold">
              Göster
              <input type="checkbox" checked={selected.enabled} onChange={(event) => updateScene({ enabled: event.target.checked })} />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Dahili ad"><input className={inputClass} value={selected.name} onChange={(event) => updateScene({ name: event.target.value })} /></Field>
            <Field label="Sahne türü">
              <select className={inputClass} value={selected.type} onChange={(event) => changeSceneType(event.target.value as ShowcaseSceneType)}>
                {(Object.keys(TYPE_LABELS) as ShowcaseSceneType[]).map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
              </select>
            </Field>
            <Field label="Başlık" hint="Boş bırakırsan ekranda başlık gösterilmez."><input className={inputClass} value={selected.title ?? ""} onChange={(event) => updateScene({ title: event.target.value })} /></Field>
            <Field label="Alt başlık" hint="Boş bırakırsan ekranda alt başlık gösterilmez."><input className={inputClass} value={selected.subtitle ?? ""} onChange={(event) => updateScene({ subtitle: event.target.value })} /></Field>
            <Field label="Rozet / küçük başlık" hint="Boş bırakırsan rozet gösterilmez."><input className={inputClass} value={selected.badge ?? ""} onChange={(event) => updateScene({ badge: event.target.value })} /></Field>
            {selected.type === "product" || selected.type === "menu" ? (
              <Field label="Toplam sahne süresi" hint="Seçilen ürün veya menü sayfalarına göre otomatik hesaplanır.">
                <div className={`${inputClass} cursor-default text-stone-300`}>{selectedSceneDuration} saniye</div>
              </Field>
            ) : (
              <Field label="Süre (saniye)" hint="Videolarda bu değer aynı zamanda güvenlik süresi olarak kullanılır.">
                <input type="number" min={5} max={3600} className={inputClass} value={selected.durationSeconds} onChange={(event) => updateScene({ durationSeconds: Number(event.target.value) })} />
              </Field>
            )}
            <div className="md:col-span-2">
              <Field
                label={selected.type === "message" ? "Duyuru metni" : "Ek metin"}
                hint={selected.type === "message"
                  ? "Alt başlıktan bağımsız görünür. Boş bırakırsan ek metin gösterilmez."
                  : "Boş bırakırsan ek metin gösterilmez."}
              >
                <textarea rows={selected.type === "message" ? 5 : 3} className={inputClass} value={selected.body ?? ""} onChange={(event) => updateScene({ body: event.target.value })} />
              </Field>
            </div>
            {selected.type === "message" ? (
              <div className="md:col-span-2 rounded-xl border border-orange-500/25 bg-orange-500/5 p-3 text-xs leading-5 text-stone-300">
                Bu sahne; geçici kapanış, özel çalışma saati, yoğunluk, teslimat gecikmesi veya özel gün bilgilendirmesi için kullanılır. Başlık, alt başlık ve duyuru metni artık ekranda ayrı ayrı gösterilir.
              </div>
            ) : null}

            <Field label="Geçiş efekti">
              <select className={inputClass} value={selected.transition} onChange={(event) => updateScene({ transition: event.target.value as ShowcaseScene["transition"] })}>
                <option value="fade">Yumuşak geçiş</option>
                <option value="slide">Yandan geçiş</option>
                <option value="zoom">Yumuşak yakınlaştırma</option>
                <option value="none">Efektsiz</option>
              </select>
            </Field>
            <Field label="Vurgu rengi"><input type="color" className={`${inputClass} h-11 p-1`} value={selected.accent || "#ff9d2e"} onChange={(event) => updateScene({ accent: event.target.value })} /></Field>

            {selected.type === "video" ? (
              <Field label="Videoya bağlı ürün">
                <select className={inputClass} value={selected.productId || ""} onChange={(event) => updateScene({ productId: event.target.value || undefined, productIds: event.target.value ? [event.target.value] : [] })}>
                  <option value="">Ürün bağlama</option>
                  {data.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {(product.displayPrice ?? product.price).toFixed(2)} €</option>)}
                </select>
              </Field>
            ) : null}

            {selected.type === "campaign" ? (
              <Field label="Veritabanından kampanya">
                <select className={inputClass} value={selected.campaignId || ""} onChange={(event) => updateScene({ campaignId: event.target.value || undefined })}>
                  <option value="">Kampanya bağlama</option>
                  {data.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}
                </select>
              </Field>
            ) : null}

            {selected.type !== "product" && selected.type !== "menu" ? (
              <Field label="Medya yerleşimi">
                <select className={inputClass} value={selected.fit || "cover"} onChange={(event) => updateScene({ fit: event.target.value as "cover" | "contain" })}>
                  <option value="cover">Ekranı tamamen doldur</option>
                  <option value="contain">Dosyanın tamamını göster</option>
                </select>
              </Field>
            ) : null}

            <Field label="Başlangıç zamanı (isteğe bağlı)"><input type="datetime-local" className={inputClass} value={localDate(selected.startAt)} onChange={(event) => updateScene({ startAt: isoDate(event.target.value) })} /></Field>
            <Field label="Bitiş zamanı (isteğe bağlı)"><input type="datetime-local" className={inputClass} value={localDate(selected.endAt)} onChange={(event) => updateScene({ endAt: isoDate(event.target.value) })} /></Field>

            <div className="md:col-span-2 rounded-xl border border-stone-800 bg-stone-950/60 p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {selected.type === "product" || selected.type === "menu" ? (
                  <div className="flex items-center justify-between gap-3 text-sm text-stone-400">
                    <span>Logo</span>
                    <span className="rounded-full border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] font-bold text-stone-300">Bu sahnede kapalı</span>
                  </div>
                ) : (
                  <label className="flex items-center justify-between gap-3 text-sm">Logoyu göster<input type="checkbox" checked={selected.showLogo !== false} onChange={(event) => updateScene({ showLogo: event.target.checked })} /></label>
                )}
                <label className="flex items-center justify-between gap-3 text-sm">QR kodu göster<input type="checkbox" checked={selected.showQr === true} onChange={(event) => updateScene({ showQr: event.target.checked })} /></label>
                <label className="flex items-center justify-between gap-3 text-sm">Fiyatı göster<input type="checkbox" checked={selected.showPrice !== false} onChange={(event) => updateScene({ showPrice: event.target.checked })} /></label>
              </div>
            </div>

            <Field label="QR hedefi (boş = varsayılan)"><input className={inputClass} value={selected.qrUrl || ""} placeholder={draft.settings.qrUrl} onChange={(event) => updateScene({ qrUrl: event.target.value })} /></Field>
            <Field label="QR açıklaması" hint="Boş bırakırsan QR kodunun altında açıklama gösterilmez."><input className={inputClass} value={selected.qrLabel ?? ""} onChange={(event) => updateScene({ qrLabel: event.target.value })} /></Field>
          </div>

          {selected.type === "product" ? (
            <section className="rounded-2xl border border-orange-700/40 bg-orange-950/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[.16em] text-orange-300">Çoklu ürün akışı</div>
                  <h3 className="mt-1 font-black text-white">Ürünleri seç ve gösterim sırasını belirle</h3>
                  <p className="mt-1 max-w-3xl text-sm leading-relaxed text-stone-300">
                    Her ürün tek ve düzenli bir kartta gösterilir: üstte ürün görseli, altta ürün adı, içindekiler, alerjenler ve güncel fiyat. Süre dolunca sıradaki ürün aynı düzenle gelir.
                  </p>
                </div>
                <div className="rounded-xl border border-orange-700/40 bg-black/25 px-3 py-2 text-xs text-orange-100">
                  {selectedProducts.length} ürün · toplam {selectedSceneDuration} saniye
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_190px]">
                <Field label="Ürün ekle">
                  <select
                    className={inputClass}
                    value=""
                    onChange={(event) => {
                      addProductToScene(event.target.value);
                      event.target.value = "";
                    }}
                  >
                    <option value="">Listeden ürün seç…</option>
                    {data.products
                      .filter((product) => !selectedProducts.some((selectedProduct) => selectedProduct.id === product.id))
                      .map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.groupLabel && product.groupLabel !== product.categoryLabel ? `${product.groupLabel} · ` : ""}{product.name} · {(product.displayPrice ?? product.price).toFixed(2)} €{product.campaignBadge ? ` · ${product.campaignBadge}` : ""}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Ürün başına süre" hint="Bu süre dolunca sıradaki ürün aynı yerleşimle otomatik gelir.">
                  <input
                    type="number"
                    min={6}
                    max={120}
                    className={inputClass}
                    value={selected.productSeconds || 12}
                    onChange={(event) => updateScene({ productSeconds: Number(event.target.value) })}
                  />
                </Field>
              </div>

              <div className="mt-4 rounded-2xl border border-stone-800 bg-stone-950/55 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-black text-white">Ürün görseli yerleşimi</h4>
                    <p className="text-xs text-stone-400">Görsel üst alanda sabit kalır; kırpmadan boyutunu ve merkezini ayarlayabilirsin.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateScene({ productImageFit: "contain", productImageScale: 82, productImageX: 0, productImageY: 0 })}
                    className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs font-bold text-stone-200 hover:bg-stone-800"
                  >
                    Varsayılana dön
                  </button>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label="Görsel biçimi">
                    <select
                      className={inputClass}
                      value={selected.productImageFit || "contain"}
                      onChange={(event) => updateScene({ productImageFit: event.target.value as "contain" | "cover" })}
                    >
                      <option value="contain">Görselin tamamını göster</option>
                      <option value="cover">Alanı doldur ve kırp</option>
                    </select>
                  </Field>
                  <Field label={`Görsel boyutu: ${Math.round(selected.productImageScale || 82)}%`}>
                    <input
                      type="range" min={35} max={130} step={1}
                      className="w-full accent-orange-500"
                      value={selected.productImageScale || 82}
                      onChange={(event) => updateScene({ productImageScale: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={`Yatay konum: ${Math.round(selected.productImageX || 0)}%`}>
                    <input
                      type="range" min={-40} max={40} step={1}
                      className="w-full accent-orange-500"
                      value={selected.productImageX || 0}
                      onChange={(event) => updateScene({ productImageX: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={`Dikey konum: ${Math.round(selected.productImageY || 0)}%`}>
                    <input
                      type="range" min={-40} max={40} step={1}
                      className="w-full accent-orange-500"
                      value={selected.productImageY || 0}
                      onChange={(event) => updateScene({ productImageY: Number(event.target.value) })}
                    />
                  </Field>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {selectedProducts.length ? selectedProducts.map((product, index) => (
                  <div key={product.id} className="flex items-center gap-3 rounded-xl border border-stone-800 bg-stone-950/70 p-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black">
                      {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-2xl">🍔</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="truncate text-sm text-white">{index + 1}. {product.groupLabel && product.groupLabel !== product.categoryLabel ? `${product.groupLabel} · ` : ""}{product.name}</strong>
                        {product.campaignBadge ? <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-black text-white">{product.campaignBadge}</span> : null}
                      </div>
                      <div className="mt-1 text-xs text-stone-400">
                        {product.originalPrice ? <span className="mr-2 line-through">{product.originalPrice.toFixed(2)} €</span> : null}
                        <span className="font-bold text-orange-200">{(product.displayPrice ?? product.price).toFixed(2)} €</span>
                        {product.description ? <span> · İçerik metni hazır</span> : <span> · İçerik metni eksik</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => moveProductInScene(product.id, -1)} disabled={index === 0} className="rounded-lg bg-stone-800 px-2 py-1.5 text-xs disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => moveProductInScene(product.id, 1)} disabled={index === selectedProducts.length - 1} className="rounded-lg bg-stone-800 px-2 py-1.5 text-xs disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => removeProductFromScene(product.id)} className="rounded-lg bg-red-950 px-2 py-1.5 text-xs text-red-300">Sil</button>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-stone-700 p-5 text-center text-sm text-stone-400">
                    Henüz ürün seçilmedi. Üstteki listeden birden fazla ürün ekleyebilirsin.
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {selected.type === "menu" ? (
            <section className="rounded-2xl border border-violet-700/40 bg-violet-950/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[.16em] text-violet-300">Gruplu dijital menü</div>
                  <h3 className="mt-1 font-black text-white">Menü sayfalarını veritabanından otomatik oluştur</h3>
                  <p className="mt-1 max-w-3xl text-sm leading-relaxed text-stone-300">
                    Aktif ürünler kategori ve mevcut içecek/ekstra grupları halinde listelenir. Fiyatlar, Pfand bilgileri ve kampanyalar canlı veriden gelir; ürün sayısı fazlaysa ekran otomatik olarak bir sonraki menü sayfasına geçer.
                  </p>
                </div>
                <div className="rounded-xl border border-violet-700/40 bg-black/25 px-3 py-2 text-xs text-violet-100">
                  {selectedMenuPages.length} menü sayfası · toplam {selectedSceneDuration} saniye
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-stone-800 bg-stone-950/55 p-3">
                <span className="text-sm font-bold text-white">Seçilen gruplar:</span>
                {(selected.menuCategories || []).length ? (selected.menuCategories || []).map((category) => (
                  <span key={category} className="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-bold text-violet-100">
                    {showcaseCategoryLabel(category, "tr")}
                  </span>
                )) : <span className="text-xs text-amber-300">Henüz grup seçilmedi</span>}
                <button type="button" onClick={clearMenuCategories} className="ml-auto rounded-lg border border-stone-700 px-3 py-1.5 text-xs font-bold text-stone-300 hover:bg-stone-800">Seçimi temizle</button>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {availableCategories.map((category) => {
                  const count = data.products.filter((product) => product.category === category).length;
                  const checked = (selected.menuCategories || []).includes(category);
                  return (
                    <div key={category} className={`rounded-xl border p-2 transition ${checked ? "border-violet-400 bg-violet-500/15" : "border-stone-800 bg-stone-950/70"}`}>
                      <button
                        type="button"
                        aria-pressed={checked}
                        onClick={() => setOnlyMenuCategory(category)}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm"
                      >
                        <span className={`font-bold ${checked ? "text-violet-50" : "text-stone-300"}`}>{checked ? "✓ " : ""}{showcaseCategoryLabel(category, "tr")}</span>
                        <span className="rounded-full bg-black/35 px-2 py-0.5 text-xs text-stone-300">{count}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleMenuCategory(category)}
                        className="mt-1 w-full rounded-lg border border-stone-700/70 px-2 py-1 text-[11px] font-bold text-stone-400 hover:border-violet-500/60 hover:text-violet-100"
                      >
                        {checked ? "Çoklu seçimden çıkar" : "Çoklu seçime ekle"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {(selected.menuCategories || []).length === 0 ? (
                <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-200">
                  Dijital menü boş kalır. Bir grup adına tıkla; yalnız o grup seçilir. Birden fazla grup için “Çoklu seçime ekle” düğmesini kullan.
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Field label="Kolon sayısı">
                  <select className={inputClass} value={selected.menuColumns || 2} onChange={(event) => updateScene({ menuColumns: Number(event.target.value) === 3 ? 3 : 2 })}>
                    <option value={2}>2 kolon</option>
                    <option value={3}>3 kolon</option>
                  </select>
                </Field>
                <Field label="Sayfa başına ürün">
                  <input type="number" min={4} max={24} className={inputClass} value={selected.menuItemsPerPage || 8} onChange={(event) => updateScene({ menuItemsPerPage: Number(event.target.value) })} />
                </Field>
                <Field label="Sayfa süresi">
                  <input type="number" min={6} max={120} className={inputClass} value={selected.menuPageSeconds || 12} onChange={(event) => updateScene({ menuPageSeconds: Number(event.target.value) })} />
                </Field>
                <Field label="Küçük ürün görselleri">
                  <button type="button" onClick={() => updateScene({ menuShowImages: selected.menuShowImages === false })} className={`${inputClass} text-left`}>
                    {selected.menuShowImages === false ? "Gizli" : "Gösteriliyor"}
                  </button>
                </Field>
                <Field label={`Küçük görsel boyutu: ${Math.round(selected.menuImageSize || 58)} px`}>
                  <input
                    type="range"
                    min={36}
                    max={104}
                    step={2}
                    disabled={selected.menuShowImages === false}
                    className="w-full accent-orange-500 disabled:opacity-40"
                    value={selected.menuImageSize || 58}
                    onChange={(event) => updateScene({ menuImageSize: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Kısa açıklamalar">
                  <button type="button" onClick={() => updateScene({ menuShowDescriptions: !selected.menuShowDescriptions })} className={`${inputClass} text-left`}>
                    {selected.menuShowDescriptions ? "Gösteriliyor" : "Gizli"}
                  </button>
                </Field>
              </div>
            </section>
          ) : null}

          {selected.type === "hero" ? (
            <section className="rounded-2xl border border-sky-700/40 bg-sky-950/25 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-black uppercase tracking-[.16em] text-sky-300">Web sitesiyle otomatik bağlantı</div>
                  <h3 className="mt-1 font-black text-white">Giriş sayfasındaki tema, video ve logo</h3>
                  <p className="mt-1 text-sm leading-relaxed text-stone-300">
                    Bu sahnede özel bir medya URL’si yoksa ana giriş sayfasında aktif olan arka plan videosu,
                    etkinlik teması, kar ve diğer efektler ile temaya ait logo otomatik kullanılır.
                    Ana sitede temayı değiştirdiğinde TV ekranı da sonraki yenilemede aynı görünüme geçer.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-sky-700/50 bg-black/25 px-3 py-1.5">Aktif tema: <b>{data.branding.themeId}</b></span>
                    <span className="rounded-full border border-sky-700/50 bg-black/25 px-3 py-1.5">Logo: <b>ana siteden otomatik</b></span>
                    <span className="rounded-full border border-sky-700/50 bg-black/25 px-3 py-1.5">Arka plan: <b>{selected.mediaUrl ? "özel medya" : "ana siteden otomatik"}</b></span>
                  </div>
                </div>
                {selected.mediaUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      updateScene({ mediaUrl: undefined, posterUrl: undefined, fit: "cover" });
                      setMessage("Giriş sahnesi yeniden ana web sitesi temasına bağlandı.");
                    }}
                    className="rounded-xl border border-sky-500/50 bg-sky-500/10 px-4 py-2 text-sm font-bold text-sky-100 hover:bg-sky-500/20"
                  >
                    Site temasını kullan
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {selected.type !== "product" && selected.type !== "menu" ? (
          <section className="rounded-2xl border border-stone-800 bg-stone-950/60 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h3 className="font-black">Video ve görseller</h3>
                <p className="text-xs text-stone-500">Dosyalar GitHub veya Supabase Storage yerine doğrudan Cloudinary alanına yüklenir.</p>
              </div>
              <button onClick={() => fileRef.current?.click()} disabled={!data.storage.configured || uploadProgress !== null} className="ml-auto rounded-xl bg-stone-100 px-4 py-2 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40">
                Dosya yükle
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept="video/mp4,video/webm,image/jpeg,image/png,image/webp,image/avif"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadMedia(file);
                }}
              />
            </div>

            {!data.storage.configured ? (
              <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-200">
                Cloudinary henüz ayarlanmadı. Vercel içinde <code>CLOUDINARY_CLOUD_NAME</code>, <code>CLOUDINARY_API_KEY</code> ve <code>CLOUDINARY_API_SECRET</code> değişkenleri bulunmalı.
              </div>
            ) : null}

            {uploadProgress !== null ? (
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-stone-400"><span>Yükleniyor</span><span>{uploadProgress}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-stone-800"><div className="h-full bg-orange-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div>
              </div>
            ) : null}

            <Field label="Doğrudan medya URL’si" hint="Harici bir alanda bulunan mevcut dosya için de kullanılabilir.">
              <input className={`${inputClass} mt-3`} value={selected.mediaUrl || ""} onChange={(event) => updateScene({ mediaUrl: event.target.value })} placeholder="https://.../video.mp4" />
            </Field>

            {selected.type === "video" ? (
              <div className="mt-3"><Field label="Kapak görseli / Poster URL’si"><input className={inputClass} value={selected.posterUrl || ""} onChange={(event) => updateScene({ posterUrl: event.target.value })} /></Field></div>
            ) : null}

            {data.media.length ? (
              <div className="mt-4 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                {data.media.map((item) => (
                  <div key={item.id} className={`group relative overflow-hidden rounded-xl border ${selected.mediaUrl === item.url ? "border-orange-500" : "border-stone-800"} bg-stone-900`}>
                    <button onClick={() => updateScene({ mediaUrl: item.url })} className="block w-full text-left">
                      <div className="aspect-video bg-black">
                        {item.mimeType.startsWith("image/") ? <img src={item.url} alt="" className="h-full w-full object-cover" /> : <video src={item.url} muted preload="metadata" className="h-full w-full object-cover" />}
                      </div>
                      <div className="p-2"><div className="truncate text-xs font-bold">{item.name}</div><div className="mt-1 text-[10px] text-stone-500">{formatBytes(item.size)}{item.durationSeconds ? ` · ${item.durationSeconds}s` : ""}</div></div>
                    </button>
                    <button onClick={() => void deleteMedia(item)} className="absolute right-1.5 top-1.5 rounded-lg bg-black/80 px-2 py-1 text-xs text-red-300 opacity-0 transition group-hover:opacity-100">Sil</button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          ) : null}
        </main>

        <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
          <section className="rounded-2xl border border-stone-800 bg-stone-900/55 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="font-black">Canlı önizleme</h2><p className="text-xs text-stone-500">Yatay, dikey ve ultra geniş ekranı burada test et.</p></div>
              <span className="rounded-full bg-stone-800 px-3 py-1 text-xs font-bold">{selected.type === "product" ? `${selectedProducts.length} ürün` : selected.type === "menu" ? `${selectedMenuPages.length} sayfa` : selectedProduct?.name || TYPE_LABELS[selected.type]}</span>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-xl border border-stone-800 bg-stone-950/60 p-1.5">
              {([
                ["landscape", "16:9 Yatay"],
                ["portrait", "9:16 Dikey"],
                ["ultrawide", "21:9 Geniş"],
              ] as Array<[ShowcasePreviewAspect, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPreviewAspect(value)}
                  className={`rounded-lg px-2 py-1.5 text-[11px] font-bold ${previewAspect === value ? "bg-orange-500 text-black" : "text-stone-400 hover:bg-stone-800"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <ShowcaseStage snapshot={previewSnapshot} scene={selected} sceneIndex={Math.max(0, selectedIndex)} sceneCount={draft.scenes.length} preview previewAspect={previewAspect} online />
          </section>

          <section className="rounded-2xl border border-stone-800 bg-stone-900/55 p-4">
            <h2 className="font-black">Genel ekran ayarları</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Ad"><input className={inputClass} value={draft.settings.name} onChange={(event) => updateSettings({ name: event.target.value })} /></Field>
              <Field label="Varsayılan süre"><input type="number" min={5} className={inputClass} value={draft.settings.defaultDurationSeconds} onChange={(event) => updateSettings({ defaultDurationSeconds: Number(event.target.value) })} /></Field>
              <Field label="Canlı senkron süresi (sn.)" hint="Yayınla işleminden sonra açık TV ekranları sayfa yenilemeden en geç bu sürede güncellenir.">
                <input type="number" min={2} max={5} className={inputClass} value={draft.settings.refreshSeconds} onChange={(event) => updateSettings({ refreshSeconds: Number(event.target.value) })} />
              </Field>
              <Field label="Arka plan"><select className={inputClass} value={draft.settings.background} onChange={(event) => updateSettings({ background: event.target.value as ShowcaseDocument["settings"]["background"] })}><option value="theme">Aktif web sitesi teması</option><option value="dark">Koyu</option><option value="black">Siyah</option></select></Field>
              <div className="sm:col-span-2"><Field label="Varsayılan QR hedefi"><input className={inputClass} value={draft.settings.qrUrl} onChange={(event) => updateSettings({ qrUrl: event.target.value })} /></Field></div>
              <Field label="Yeni sahneler için QR açıklaması" hint="Boş bırakırsan yeni sahnelerde QR açıklaması eklenmez."><input className={inputClass} value={draft.settings.qrLabel} onChange={(event) => updateSettings({ qrLabel: event.target.value })} /></Field>
              <div className="sm:col-span-2"><Field label="Kayan yazı" hint="Boş bırakırsan kayan yazı tamamen gizlenir."><input className={inputClass} value={draft.settings.ticker} onChange={(event) => updateSettings({ ticker: event.target.value })} /></Field></div>
            </div>
            <div className="mt-4 grid gap-2 rounded-xl border border-stone-800 bg-stone-950/60 p-3 sm:grid-cols-3">
              <label className="flex items-center justify-between gap-2 text-sm">Saati göster<input type="checkbox" checked={draft.settings.showClock} onChange={(event) => updateSettings({ showClock: event.target.checked })} /></label>
              <label className="flex items-center justify-between gap-2 text-sm">İlerleme göstergesi<input type="checkbox" checked={draft.settings.showProgress} onChange={(event) => updateSettings({ showProgress: event.target.checked })} /></label>
              <label className="flex items-center justify-between gap-2 text-sm">Bağlantı durumu<input type="checkbox" checked={draft.settings.showConnectionState} onChange={(event) => updateSettings({ showConnectionState: event.target.checked })} /></label>
            </div>
          </section>

          <section className="rounded-2xl border border-stone-800 bg-stone-900/55 p-4 text-sm">
            <h2 className="font-black">Sistem durumu</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              <dt className="text-stone-500">Yayın tarihi</dt><dd className="text-right font-semibold">{data.published.publishedAt ? new Date(data.published.publishedAt).toLocaleString("de-DE") : "Henüz yayınlanmadı"}</dd>
              <dt className="text-stone-500">Sürüm</dt><dd className="truncate text-right font-mono text-stone-300">{data.published.version}</dd>
              <dt className="text-stone-500">Ürünler</dt><dd className="text-right font-semibold">{data.products.length}</dd>
              <dt className="text-stone-500">Kampanyalar</dt><dd className="text-right font-semibold">{data.campaigns.length}</dd>
              <dt className="text-stone-500">Medya alanı</dt><dd className={`text-right font-semibold ${data.storage.configured ? "text-emerald-400" : "text-amber-400"}`}>{data.storage.configured ? `Cloudinary · ${data.storage.cloudName}` : "Ayarlanmadı"}</dd>
              {data.storage.maxUploadBytes ? <><dt className="text-stone-500">En büyük dosya</dt><dd className="text-right font-semibold">{formatBytes(data.storage.maxUploadBytes)}</dd></> : null}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
