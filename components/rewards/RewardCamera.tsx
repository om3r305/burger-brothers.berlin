"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  onChange: (file: File | null, previewUrl: string | null) => void;
  onDraftChange?: (hasUnconfirmedPhoto: boolean) => void;
};

async function canvasFileFromSource(
  source: CanvasImageSource,
  width: number,
  height: number,
  mirror = false,
) {
  const maxSide = 1080;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_NOT_AVAILABLE");

  if (mirror) {
    context.translate(targetWidth, 0);
    context.scale(-1, 1);
  }
  context.drawImage(source, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.82),
  );
  if (!blob) throw new Error("PHOTO_CONVERSION_FAILED");
  return new File([blob], `gluecksmoment-${Date.now()}.webp`, {
    type: "image/webp",
  });
}

async function requestCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("CAMERA_API_NOT_AVAILABLE");
  }

  const attempts: MediaStreamConstraints[] = [
    {
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 1280 },
      },
      audio: false,
    },
    { video: { facingMode: "user" }, audio: false },
    { video: true, audio: false },
  ];

  let lastError: unknown = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("CAMERA_OPEN_FAILED");
}

export default function RewardCamera({ onChange, onDraftChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<string | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setCameraOpen(false);
  }, []);

  const clearPreview = useCallback(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl(null);
    setSelectedFile(null);
    setConfirmed(false);
    onChange(null, null);
    onDraftChange?.(false);
  }, [onChange, onDraftChange]);

  const setPhoto = useCallback(
    (file: File | null) => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const nextUrl = file ? URL.createObjectURL(file) : null;
      previewRef.current = nextUrl;
      setSelectedFile(file);
      setPreviewUrl(nextUrl);
      setConfirmed(false);
      // Fotoğraf çekildi ama müşteri henüz "Foto verwenden" demedi.
      // Parent state temiz tutulur ve genel paylaşım butonu kilitlenir.
      onChange(null, null);
      onDraftChange?.(Boolean(file));
    },
    [onChange, onDraftChange],
  );

  const confirmPhoto = useCallback(() => {
    if (!selectedFile || !previewUrl) return;
    setConfirmed(true);
    onChange(selectedFile, previewUrl);
    onDraftChange?.(false);
  }, [onChange, onDraftChange, previewUrl, selectedFile]);

  useEffect(() => {
    if (!cameraOpen || !streamRef.current || !videoRef.current) return;

    let cancelled = false;
    const video = videoRef.current;
    const stream = streamRef.current;

    const startPlayback = async () => {
      try {
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.setAttribute("webkit-playsinline", "true");
        video.srcObject = stream;

        if (video.readyState < video.HAVE_METADATA) {
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error("CAMERA_METADATA_TIMEOUT")), 4500);
            const ready = () => {
              window.clearTimeout(timer);
              video.removeEventListener("loadedmetadata", ready);
              video.removeEventListener("error", failed);
              resolve();
            };
            const failed = () => {
              window.clearTimeout(timer);
              video.removeEventListener("loadedmetadata", ready);
              video.removeEventListener("error", failed);
              reject(new Error("CAMERA_VIDEO_ERROR"));
            };
            video.addEventListener("loadedmetadata", ready, { once: true });
            video.addEventListener("error", failed, { once: true });
          });
        }

        await video.play();
        if (!cancelled) setCameraReady(video.videoWidth > 0 && video.videoHeight > 0);
      } catch (caught) {
        console.error("[reward-camera] preview failed", caught);
        if (!cancelled) {
          setError("Die Kameravorschau konnte nicht gestartet werden. Bitte nutze die Telefonkamera.");
          stopCamera();
          window.setTimeout(() => inputRef.current?.click(), 50);
        }
      }
    };

    void startPlayback();
    return () => {
      cancelled = true;
    };
  }, [cameraOpen, stopCamera]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const openCamera = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    clearPreview();
    stopCamera();

    try {
      const stream = await requestCameraStream();
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (caught) {
      console.error("[reward-camera] getUserMedia failed", caught);
      setError("Die Kamera konnte nicht geöffnet werden. Bitte nutze die Telefonkamera.");
      window.setTimeout(() => inputRef.current?.click(), 50);
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!cameraReady || !video?.videoWidth || !video.videoHeight || busy) return;
    setBusy(true);
    setError("");
    try {
      const file = await canvasFileFromSource(
        video,
        video.videoWidth,
        video.videoHeight,
        true,
      );
      stopCamera();
      setPhoto(file);
    } catch (caught) {
      console.error("[reward-camera] capture failed", caught);
      setError("Das Foto konnte nicht vorbereitet werden. Bitte versuche es erneut.");
    } finally {
      setBusy(false);
    }
  };

  const readFallback = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError("");
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const next = new Image();
        next.onload = () => resolve(next);
        next.onerror = reject;
        next.src = url;
      });
      const converted = await canvasFileFromSource(
        image,
        image.naturalWidth,
        image.naturalHeight,
      );
      setPhoto(converted);
    } catch (caught) {
      console.error("[reward-camera] fallback conversion failed", caught);
      setError("Dieses Foto konnte nicht verwendet werden. Bitte nimm ein neues Foto auf.");
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (previewUrl && selectedFile) {
    return (
      <div className="space-y-3">
        <div className={`overflow-hidden rounded-3xl border bg-black ${
          confirmed ? "border-emerald-300/70" : "border-amber-300/40"
        }`}>
          <img
            src={previewUrl}
            alt="Foto-Vorschau"
            className="aspect-square w-full object-cover"
          />
        </div>

        {confirmed ? (
          <div className="rounded-2xl border border-emerald-300/35 bg-emerald-400/10 p-3 text-center">
            <p className="font-black text-emerald-200">✓ Foto ausgewählt</p>
            <p className="mt-1 text-sm text-white/70">
              Dieses Foto wird nach deiner Bestätigung zur Prüfung gesendet.
            </p>
          </div>
        ) : (
          <p className="text-center text-sm font-bold text-white">
            Gefällt dir dein Foto?
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void openCamera()}
            className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 font-black text-white"
          >
            🔄 Nochmal aufnehmen
          </button>

          {confirmed ? (
            <button
              type="button"
              disabled
              className="rounded-2xl bg-emerald-500/35 px-4 py-3 font-black text-emerald-100"
            >
              ✓ Wird mitgesendet
            </button>
          ) : (
            <button
              type="button"
              className="rounded-2xl bg-emerald-400 px-4 py-3 font-black text-black"
              onClick={confirmPhoto}
            >
              ✓ Foto verwenden
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={clearPreview}
          className="w-full text-sm font-bold text-stone-300 underline"
        >
          Foto entfernen
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(event) => void readFallback(event.target.files?.[0] || null)}
      />

      {cameraOpen ? (
        <div className="fixed inset-0 z-[1700] flex flex-col bg-black">
          <div className="flex items-center justify-between p-4 text-white">
            <div>
              <strong className="block">Dein Glücksfoto</strong>
              <span className="text-xs text-white/60">Die Frontkamera wird bevorzugt.</span>
            </div>
            <button
              type="button"
              onClick={stopCamera}
              className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-xl"
              aria-label="Kamera schließen"
            >
              ✕
            </button>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-stone-950">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full -scale-x-100 object-cover"
            />
            {!cameraReady ? (
              <div className="absolute inset-0 grid place-items-center bg-black/70 text-center text-white">
                <div>
                  <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-amber-300" />
                  <p className="mt-3 font-bold">Kamera wird gestartet…</p>
                </div>
              </div>
            ) : null}
            <div className="pointer-events-none absolute inset-8 rounded-[2.5rem] border-2 border-white/55 shadow-[0_0_0_999px_rgba(0,0,0,.14)]" />
          </div>
          <div className="grid place-items-center gap-3 border-t border-white/10 p-6">
            <button
              type="button"
              onClick={() => void capture()}
              disabled={busy || !cameraReady}
              aria-label="Foto aufnehmen"
              className="h-20 w-20 rounded-full border-[7px] border-white bg-amber-400 shadow-2xl disabled:opacity-40"
            />
            <button
              type="button"
              onClick={() => {
                stopCamera();
                window.setTimeout(() => inputRef.current?.click(), 50);
              }}
              className="text-sm font-bold text-white/75 underline"
            >
              Telefonkamera verwenden
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void openCamera()}
          disabled={busy}
          className="w-full rounded-2xl border border-amber-300/40 bg-amber-300/10 px-5 py-4 text-lg font-black text-amber-100 disabled:opacity-50"
        >
          📸 Foto aufnehmen
        </button>
      )}

      {error ? <p className="text-sm leading-5 text-amber-200">{error}</p> : null}
    </div>
  );
}
