"use client";

import { useEffect, useMemo, useState } from "react";
import {
  activateAdminPushFromGesture,
  disableAdminPush,
  ensureAdminPushRegistration,
  isAdminIOS,
  isAdminStandalone,
  loadAdminPushState,
} from "@/lib/client/admin-push";

type DeferredInstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Props = {
  compact?: boolean;
  onNavigate?: () => void;
};

export default function AdminPwaControls({ compact = false, onNavigate }: Props) {
  const [installPrompt, setInstallPrompt] =
    useState<DeferredInstallPrompt | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState<"" | "install" | "push">("");
  const [message, setMessage] = useState("");
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  useEffect(() => {
    setStandalone(isAdminStandalone());
    setPermission(
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission,
    );

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
    };
    const installed = () => {
      setStandalone(true);
      setInstallPrompt(null);
      setMessage("Burger Admin ana ekrana eklendi.");
    };

    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);

    void loadAdminPushState()
      .then((state) => setSubscribed(state.subscribed === true))
      .catch(() => undefined);
    void ensureAdminPushRegistration().then((ok) => {
      if (ok) setSubscribed(true);
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const pushLabel = useMemo(() => {
    if (permission === "denied") return "Bildirim engelli";
    if (subscribed) return "Bildirim açık";
    return "Bildirimleri aç";
  }, [permission, subscribed]);

  const install = async () => {
    if (standalone || busy) return;
    if (!installPrompt) {
      if (isAdminIOS()) setShowIOSHelp(true);
      else setMessage("Tarayıcı menüsünden “Uygulamayı yükle” seçeneğini kullan.");
      return;
    }

    setBusy("install");
    setMessage("");
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setMessage("Burger Admin kuruluyor.");
        setInstallPrompt(null);
      }
    } finally {
      setBusy("");
    }
  };

  const togglePush = async () => {
    if (busy || permission === "unsupported") return;
    setBusy("push");
    setMessage("");

    try {
      if (subscribed) {
        await disableAdminPush();
        setSubscribed(false);
        setMessage("Telefon bildirimleri kapatıldı.");
      } else {
        const result = await activateAdminPushFromGesture();
        if (result.ok) {
          setSubscribed(true);
          setPermission("granted");
          setMessage("Fotoğraf ve Google yorum bildirimleri açık.");
        } else {
          const messages: Record<string, string> = {
            ios_home_screen_required:
              "iPhone’da önce Burger Admin’i ana ekrana ekle, sonra uygulamanın içinden bildirimleri aç.",
            permission_denied:
              "Bildirim izni tarayıcı ayarlarında engelli. Site ayarlarından izin ver.",
            permission_default: "Bildirim izni verilmedi.",
            not_configured: "VAPID bildirim anahtarları hazır değil.",
            unsupported: "Bu cihaz Web Push desteklemiyor.",
            subscription_failed: "Telefon bildirim aboneliği oluşturulamadı.",
            server_failed: "Bildirim kaydı şu anda tamamlanamadı.",
          };
          setMessage(messages[result.code] || "Bildirim açılamadı.");
          setPermission(
            typeof Notification === "undefined"
              ? "unsupported"
              : Notification.permission,
          );
        }
      }
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <div className={compact ? "grid gap-2" : "grid gap-2 sm:grid-cols-2"}>
        {!standalone ? (
          <button
            type="button"
            onClick={() => void install()}
            disabled={Boolean(busy)}
            className="bb-admin-control-button"
          >
            {busy === "install" ? "Kuruluyor…" : "📲 Admin App’i yükle"}
          </button>
        ) : (
          <div className="bb-admin-control-status">✓ Admin App</div>
        )}

        <button
          type="button"
          onClick={() => void togglePush()}
          disabled={Boolean(busy) || permission === "unsupported"}
          className={`bb-admin-control-button ${
            subscribed ? "bb-admin-control-button--active" : ""
          }`}
        >
          {busy === "push" ? "Bekleyin…" : `🔔 ${pushLabel}`}
        </button>
      </div>

      {message ? (
        <p className="mt-2 text-xs leading-5 text-stone-400">{message}</p>
      ) : null}

      {showIOSHelp ? (
        <div
          className="fixed inset-0 z-[2200] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <section className="w-full max-w-sm rounded-3xl border border-white/15 bg-stone-950 p-6 text-white shadow-2xl">
            <div className="text-4xl">📲</div>
            <h2 className="mt-3 text-2xl font-black">iPhone’a Burger Admin ekle</h2>
            <ol className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
              <li><strong>1.</strong> Safari’nin altındaki Paylaş simgesine dokun.</li>
              <li><strong>2.</strong> “Ana Ekrana Ekle” seçeneğini aç.</li>
              <li><strong>3.</strong> Eklenen Burger Admin uygulamasını aç.</li>
              <li><strong>4.</strong> Admin menüsünden “Bildirimleri aç” de.</li>
            </ol>
            <button
              type="button"
              onClick={() => {
                setShowIOSHelp(false);
                onNavigate?.();
              }}
              className="mt-6 min-h-12 w-full rounded-2xl bg-amber-400 px-4 py-3 font-black text-black"
            >
              Tamam
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
