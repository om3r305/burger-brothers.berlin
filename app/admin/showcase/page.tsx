"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ConfirmModal, { EMPTY_CONFIRM_STATE, type ShowcaseConfirmState } from "@/components/showcase/admin/ConfirmModal";
import PremiumSceneSettings from "@/components/showcase/admin/PremiumSceneSettings";
import SceneBasicsEditor from "@/components/showcase/admin/SceneBasicsEditor";
import ProductSceneEditor from "@/components/showcase/admin/ProductSceneEditor";
import MenuSceneEditor from "@/components/showcase/admin/MenuSceneEditor";
import SceneListPanel from "@/components/showcase/admin/SceneListPanel";
import MediaLibraryPanel from "@/components/showcase/admin/MediaLibraryPanel";
import ShowcaseAdminHeader from "@/components/showcase/admin/ShowcaseAdminHeader";
import ReviewModerationPanel from "@/components/showcase/admin/ReviewModerationPanel";
import ShowcasePreviewSidebar from "@/components/showcase/admin/ShowcasePreviewSidebar";
import { inspectShowcaseFile, uploadShowcaseMediaWithProgress } from "@/lib/showcase/client-upload";
import { useShowcaseEditor } from "@/hooks/showcase/use-showcase-editor";
import {
  TYPE_LABELS,
  canonicalSceneType,
  createShowcaseScene,
  replaceSceneType,
  validateShowcaseDocument,
  type CanonicalShowcaseSceneType,
} from "@/lib/showcase/editor";
import {
  resolveWeatherMessage,
} from "@/lib/showcase/presets";
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
  ShowcaseSnapshot,
  ShowcaseScreen,
  ShowcaseReview,
  ShowcaseWeather,
  ShowcaseBestseller,
} from "@/lib/showcase/types";

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
  screen: ShowcaseScreen;
  screens: ShowcaseScreen[];
  reviews: ShowcaseReview[];
  weather?: ShowcaseWeather | null;
  bestsellers?: ShowcaseBestseller[];
  bestsellersByPeriod?: Record<string, ShowcaseBestseller[]>;
  bestsellerGeneratedAt?: string;
  generatedAt?: string;
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
  const [screenSlug, setScreenSlug] = useState("main");
  const editor = useShowcaseEditor();
  const draft = editor.document;
  const selectedId = editor.selectedId;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewAspect, setPreviewAspect] = useState<ShowcasePreviewAspect>("landscape");
  const [confirmState, setConfirmState] = useState<ShowcaseConfirmState>(EMPTY_CONFIRM_STATE);
  const loadRequestRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const screenSlugRef = useRef(screenSlug);
  const draftRef = useRef<ShowcaseDocument | null>(draft);
  screenSlugRef.current = screenSlug;
  draftRef.current = draft;

  const load = async (slug = screenSlug) => {
    const requestId = ++loadRequestRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setError("");
    try {
      const payload = (await jsonFetch(`/api/admin/showcase?screen=${encodeURIComponent(slug)}`, {
        signal: controller.signal,
      })) as AdminPayload;
      if (requestId !== loadRequestRef.current || controller.signal.aborted) return;
      setData(payload);
      editor.reset(payload.draft);
    } catch (loadError: any) {
      if (controller.signal.aborted) return;
      setError(loadError?.message || "Vitrin ekranı yüklenemedi.");
    }
  };

  useEffect(() => {
    void load(screenSlug);
    return () => loadAbortRef.current?.abort();
  }, [screenSlug]);

  const refreshLiveSources = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = (await jsonFetch(`/api/admin/showcase?screen=${encodeURIComponent(screenSlug)}`)) as AdminPayload;
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
              reviews: payload.reviews || [],
              weather: payload.weather || null,
              bestsellers: payload.bestsellers || [],
              bestsellersByPeriod: payload.bestsellersByPeriod || {},
              bestsellerGeneratedAt: payload.bestsellerGeneratedAt,
              generatedAt: payload.generatedAt,
            }
          : payload,
      );
      setMessage(`Ürünler, kampanyalar, hava durumu, yorumlar ve bestseller verileri yenilendi. Aktif tema: ${payload.branding.themeId}`);
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
      weather: data.weather || null,
      reviews: data.reviews || [],
      bestsellers: data.bestsellers || [],
      bestsellersByPeriod: data.bestsellersByPeriod || {},
      bestsellerGeneratedAt: data.bestsellerGeneratedAt,
      screen: data.screen,
    };
  }, [data, draft]);

  const applyDraft = (next: ShowcaseDocument | null, record = true, coalesceKey = "") => {
    if (!next) return;
    editor.commit(next, { record, coalesceKey });
  };

  const undo = editor.undo;
  const redo = editor.redo;

  const updateDocument = (patch: Partial<ShowcaseDocument>) => {
    if (!draft) return;
    applyDraft({ ...draft, ...patch, updatedAt: new Date().toISOString() }, true, "document");
  };

  const updateSettings = (patch: Partial<ShowcaseDocument["settings"]>) => {
    if (!draft) return;
    applyDraft({
      ...draft,
      updatedAt: new Date().toISOString(),
      settings: { ...draft.settings, ...patch },
    }, true, "settings");
  };

  const updateScene = (patch: Partial<ShowcaseScene>, structural = false, targetId = selectedId) => {
    if (!targetId || !draft) return;
    applyDraft({
      ...draft,
      updatedAt: new Date().toISOString(),
      scenes: draft.scenes.map((scene) =>
        scene.id === targetId ? { ...scene, ...patch } : scene,
      ),
    }, true, structural ? "" : `scene:${targetId}`);
  };

  const changeSceneType = (type: CanonicalShowcaseSceneType) => {
    if (!draft || !selected) return;
    const replacement = replaceSceneType(selected, type, draft);
    const scenes = draft.scenes.map((scene) => scene.id === selected.id ? replacement : scene);
    applyDraft({ ...draft, scenes, updatedAt: new Date().toISOString() }, true, "");
  };

  const setProductIds = (ids: string[]) => {
    const limit = Math.max(1, Math.min(20, Number(selected?.productLimit || 8)));
    const clean = Array.from(new Set(ids.map(String).filter(Boolean))).slice(0, limit);
    updateScene({ productIds: clean, productId: clean[0] || undefined }, true);
  };

  const addProductToScene = (productId: string) => {
    if (!productId || !selected) return;
    const ids = Array.isArray(selected.productIds)
      ? selected.productIds
      : selected.productId
        ? [selected.productId]
        : [];
    if (ids.includes(productId)) return;
    if (ids.length >= Math.max(1, Number(selected.productLimit || 8))) {
      setError(`Bu sahnede en fazla ${selected.productLimit || 8} ürün gösterilebilir.`);
      return;
    }
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
    }, true);
  };

  const setOnlyMenuCategory = (category: string) => {
    updateScene({ menuCategories: [category] }, true);
    setMessage(`Dijital menü yalnızca “${showcaseCategoryLabel(category, "tr")}” grubunu gösterecek.`);
  };

  const clearMenuCategories = () => {
    updateScene({ menuCategories: [] }, true);
    setMessage("Kategori seçimi temizlendi. TV tüm aktif kategorileri otomatik gösterecek.");
  };

  const addScene = (type: CanonicalShowcaseSceneType) => {
    if (!draft) return;
    const scene = createShowcaseScene(type, draft);
    editor.commit(
      { ...draft, scenes: [...draft.scenes, scene], updatedAt: new Date().toISOString() },
      { selectedId: scene.id },
    );
  };

  const deleteSceneNow = () => {
    if (!draft || !selected) return;
    const next = draft.scenes.filter((scene) => scene.id !== selected.id);
    const nextSelectedId = next[Math.max(0, selectedIndex - 1)]?.id || next[0]?.id || "";
    editor.commit(
      { ...draft, scenes: next, updatedAt: new Date().toISOString() },
      { selectedId: nextSelectedId },
    );
    setConfirmState(EMPTY_CONFIRM_STATE);
  };

  const deleteScene = () => {
    if (!draft || !selected) return;
    if (draft.scenes.length <= 1) {
      setError("En az bir sahne kalmalıdır.");
      return;
    }
    setConfirmState({
      open: true,
      title: "Sahneyi sil",
      message: `“${selected.name}” kalıcı olarak taslaktan silinsin mi? Bu işlemi Geri Al ile geri getirebilirsin.`,
      confirmLabel: "Sahneyi sil",
      danger: true,
      onConfirm: deleteSceneNow,
    });
  };

  const duplicateScene = () => {
    if (!draft || !selected) return;
    const copy = { ...selected, id: uid(), name: `${selected.name} Kopyası` };
    const next = [...draft.scenes];
    next.splice(selectedIndex + 1, 0, copy);
    editor.commit(
      { ...draft, scenes: next, updatedAt: new Date().toISOString() },
      { selectedId: copy.id },
    );
  };

  const moveScene = (direction: -1 | 1) => {
    if (!draft || selectedIndex < 0) return;
    const target = selectedIndex + direction;
    if (target < 0 || target >= draft.scenes.length) return;
    const next = [...draft.scenes];
    [next[selectedIndex], next[target]] = [next[target], next[selectedIndex]];
    applyDraft({ ...draft, scenes: next, updatedAt: new Date().toISOString() });
  };

  const validateDraft = validateShowcaseDocument;

  const applyValidation = (document: ShowcaseDocument) => {
    const result = validateDraft(document);
    if (result.ok) return true;
    if (result.sceneId) editor.select(result.sceneId);
    setError(result.message);
    return false;
  };

  const saveDraft = async () => {
    if (!draft || !applyValidation(draft)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await jsonFetch("/api/admin/showcase", {
        method: "PUT",
        body: JSON.stringify({ screen: screenSlug, document: draft }),
      });
      editor.reset(response.draft);
      setMessage("Taslak kaydedildi. TV ekranındaki yayın henüz değiştirilmedi.");
    } catch (saveError: any) {
      setError(saveError?.message || "Taslak kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const publishNow = async () => {
    if (!draft) return;
    setConfirmState(EMPTY_CONFIRM_STATE);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await jsonFetch("/api/admin/showcase", {
        method: "POST",
        body: JSON.stringify({ screen: screenSlug, action: "publish", document: draft }),
      });
      editor.reset(response.draft);
      setData((current) => (current ? { ...current, draft: response.draft, published: response.published } : current));
      signalShowcasePublished(response.published?.version);
      setMessage("Yayınlandı. Açık Showcase ekranları en geç 15 saniye içinde güncellenecek.");
    } catch (publishError: any) {
      setError(publishError?.message || "Yayınlama başarısız oldu.");
    } finally {
      setBusy(false);
    }
  };

  const publish = () => {
    if (!draft || !applyValidation(draft)) return;
    setConfirmState({
      open: true,
      title: "Showcase yayınını güncelle",
      message: `“${data?.screen?.name || screenSlug}” ekranındaki mevcut yayın bu taslakla değiştirilsin mi?`,
      confirmLabel: "Şimdi yayınla",
      onConfirm: publishNow,
    });
  };

  const restorePublishedNow = async () => {
    setConfirmState(EMPTY_CONFIRM_STATE);
    setBusy(true);
    try {
      const response = await jsonFetch("/api/admin/showcase", {
        method: "POST",
        body: JSON.stringify({ screen: screenSlug, action: "restorePublished" }),
      });
      editor.reset(response.draft);
      setMessage("Son yayınlanan sürüm taslak olarak yüklendi.");
    } catch (restoreError: any) {
      setError(restoreError?.message || "Geri yükleme başarısız oldu.");
    } finally {
      setBusy(false);
    }
  };

  const restorePublished = () => {
    setConfirmState({
      open: true,
      title: "Son yayınlanan sürümü yükle",
      message: "Kaydedilmemiş taslak değişiklikleri kaldırılıp son yayınlanan sürüm editöre yüklensin mi?",
      confirmLabel: "Sürümü yükle",
      danger: true,
      onConfirm: restorePublishedNow,
    });
  };

  const uploadMedia = async (file: File) => {
    const currentScene = selected;
    const targetSceneId = currentScene?.id || "";
    const targetScreenSlug = screenSlug;
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
      const upload = await uploadShowcaseMediaWithProgress(
        signed.uploadUrl,
        signed.fields,
        file,
        setUploadProgress,
      );
      const metadata = await inspectShowcaseFile(file);
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
      const currentDraft = draftRef.current;
      if (screenSlugRef.current === targetScreenSlug && currentDraft?.scenes.some((scene) => scene.id === targetSceneId)) {
        editor.commit({
          ...currentDraft,
          updatedAt: new Date().toISOString(),
          scenes: currentDraft.scenes.map((scene) => scene.id === targetSceneId
            ? {
                ...scene,
                mediaUrl: registered.item.url,
                durationSeconds: metadata.durationSeconds
                  ? Math.max(5, Math.ceil(metadata.durationSeconds))
                  : scene.durationSeconds,
              }
            : scene),
        }, { coalesceKey: "" });
        setMessage(`${file.name} yüklendi ve yüklemeyi başlattığın sahneye atandı.`);
      } else {
        setMessage(`${file.name} Cloudinary’ye yüklendi. Ekran veya sahne değiştiği için otomatik atanmadı.`);
      }
    } catch (uploadError: any) {
      setError(
        uploadError?.message === "CLOUDINARY_UPLOAD_NETWORK_ERROR"
          ? "Yükleme başarısız oldu. İnternet bağlantısını kontrol edip yeniden dene."
          : uploadError?.message || "Yükleme başarısız oldu.",
      );
    } finally {
      setUploadProgress(null);
    }
  };

  const syncGoogleReviews = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await jsonFetch("/api/admin/showcase/reviews", { method: "POST", body: JSON.stringify({ action: "sync" }) });
      setData((current) => current ? { ...current, reviews: response.reviews || [] } : current);
      setMessage("Google yorumları yenilendi. Yeni yorumlar onay bekliyor.");
    } catch (reviewError: any) {
      setError(reviewError?.message === "GOOGLE_BUSINESS_NOT_CONFIGURED" ? "Google Business bağlantısı henüz Vercel ortam değişkenlerinde ayarlanmadı." : reviewError?.message || "Google yorumları alınamadı.");
    } finally { setBusy(false); }
  };

  const setReviewApproval = async (reviewId: string, approved: boolean) => {
    if (!data) return;
    const reviews = data.reviews.map((review) => review.id === reviewId ? { ...review, approved } : review);
    setData({ ...data, reviews });
    try {
      const response = await jsonFetch("/api/admin/showcase/reviews", { method: "PUT", body: JSON.stringify({ reviews }) });
      setData((current) => current ? { ...current, reviews: response.reviews || reviews } : current);
      setMessage(approved ? "Yorum ekranlarda gösterilmek üzere onaylandı." : "Yorum yayından kaldırıldı.");
    } catch (reviewError: any) { setError(reviewError?.message || "Yorum onayı kaydedilemedi."); }
  };

  const deleteMediaNow = async (item: ShowcaseMediaItem) => {
    setConfirmState(EMPTY_CONFIRM_STATE);
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  };

  const deleteMedia = (item: ShowcaseMediaItem) => {
    setConfirmState({
      open: true,
      title: "Cloudinary medyasını sil",
      message: `“${item.name}” Cloudinary üzerinden kalıcı olarak silinsin mi?`,
      confirmLabel: "Medyayı sil",
      danger: true,
      onConfirm: () => deleteMediaNow(item),
    });
  };

  const keyboardActionsRef = useRef({
    saveDraft: () => {},
    undo: () => {},
    redo: () => {},
    deleteScene: () => {},
  });
  keyboardActionsRef.current = {
    saveDraft: () => void saveDraft(),
    undo,
    redo,
    deleteScene,
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        keyboardActionsRef.current.saveDraft();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        keyboardActionsRef.current.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
        event.preventDefault();
        keyboardActionsRef.current.redo();
        return;
      }
      if (!editing && event.key === "Delete") {
        event.preventDefault();
        keyboardActionsRef.current.deleteScene();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
  const selectedCampaign = data.campaigns.find((campaign) => campaign.id === selected.campaignId);
  const selectedBestsellerPeriod = String(Math.max(1, Number(selected.bestsellerPeriodDays || 7)));
  const selectedBestsellers = data.bestsellersByPeriod?.[selectedBestsellerPeriod] || data.bestsellers || [];
  const automaticWeatherText = resolveWeatherMessage(data.weather, new Date(), selected.weatherMessages);

  return (
    <div className="mx-auto max-w-[1900px] space-y-5">
      <ShowcaseAdminHeader
        screenSlug={screenSlug}
        screens={data.screens || []}
        busy={busy}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onScreenChange={(nextSlug) => {
          loadAbortRef.current?.abort();
          editor.clear();
          setData(null);
          setScreenSlug(nextSlug);
        }}
        onRefresh={() => void refreshLiveSources()}
        onUndo={undo}
        onRedo={redo}
        onRestore={restorePublished}
        onSave={() => void saveDraft()}
        onPublish={publish}
      />

      {message ? <div className="rounded-xl border border-emerald-700/50 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}
      {error ? <div className="rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      <ReviewModerationPanel
        reviews={data.reviews || []}
        busy={busy}
        onSync={() => void syncGoogleReviews()}
        onApproval={(id, approved) => void setReviewApproval(id, approved)}
      />

      <div className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)_minmax(520px,1.15fr)]">
        <SceneListPanel
          document={draft}
          selectedId={selected.id}
          snapshot={previewSnapshot}
          onEnabledChange={(enabled) => updateDocument({ enabled })}
          onAdd={addScene}
          onSelect={editor.select}
          onMove={moveScene}
          onDuplicate={duplicateScene}
          onDelete={deleteScene}
        />

        <main className="space-y-4 rounded-2xl border border-stone-800 bg-stone-900/55 p-4">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-800 pb-4">
            <div>
              <h2 className="font-black">Sahneyi düzenle</h2>
              <p className="text-xs text-stone-500">{TYPE_LABELS[canonicalSceneType(selected.type)]}</p>
            </div>
            <label className="ml-auto flex items-center gap-2 text-sm font-semibold">
              Göster
              <input type="checkbox" checked={selected.enabled} onChange={(event) => updateScene({ enabled: event.target.checked })} />
            </label>
          </div>

          <SceneBasicsEditor
            scene={selected}
            document={draft}
            products={data.products}
            campaigns={data.campaigns}
            sceneDuration={selectedSceneDuration}
            inputClass={inputClass}
            onChange={updateScene}
            onTypeChange={changeSceneType}
          />

          <ProductSceneEditor
            scene={selected}
            allProducts={data.products}
            selectedProducts={selectedProducts}
            sceneDuration={selectedSceneDuration}
            inputClass={inputClass}
            onChange={updateScene}
            onAdd={addProductToScene}
            onRemove={removeProductFromScene}
            onMove={moveProductInScene}
          />

          <MenuSceneEditor
            scene={selected}
            products={data.products}
            categories={availableCategories}
            pages={selectedMenuPages}
            sceneDuration={selectedSceneDuration}
            inputClass={inputClass}
            onChange={updateScene}
            onOnlyCategory={setOnlyMenuCategory}
            onToggleCategory={toggleMenuCategory}
            onClearCategories={clearMenuCategories}
          />

          <PremiumSceneSettings
            scene={selected}
            weather={data.weather}
            reviews={data.reviews || []}
            bestsellers={selectedBestsellers}
            bestsellerGeneratedAt={data.bestsellerGeneratedAt}
            automaticWeatherText={automaticWeatherText}
            inputClass={inputClass}
            onChange={updateScene}
          />

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

          <MediaLibraryPanel
            scene={selected}
            media={data.media}
            storage={data.storage}
            uploadProgress={uploadProgress}
            inputClass={inputClass}
            onChange={(patch) => updateScene(patch)}
            onUpload={uploadMedia}
            onDelete={deleteMedia}
          />

        </main>

        <ShowcasePreviewSidebar
          screenSlug={screenSlug}
          scene={selected}
          sceneIndex={selectedIndex}
          sceneCount={draft.scenes.length}
          snapshot={previewSnapshot}
          previewAspect={previewAspect}
          onPreviewAspect={setPreviewAspect}
          selectedProductName={selectedProduct?.name}
          selectedProductCount={selectedProducts.length}
          menuPageCount={selectedMenuPages.length}
          document={draft}
          published={data.published}
          productCount={data.products.length}
          campaignCount={data.campaigns.length}
          storage={data.storage}
          inputClass={inputClass}
          onSettings={updateSettings}
        />
      </div>
      <ConfirmModal
        state={confirmState}
        busy={busy}
        onClose={() => { if (!busy) setConfirmState(EMPTY_CONFIRM_STATE); }}
      />
    </div>
  );
}
