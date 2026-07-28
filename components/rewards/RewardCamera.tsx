"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onChange: (file: File | null, previewUrl: string | null) => void;
};

async function canvasFileFromSource(
  source: CanvasImageSource,
  width: number,
  height: number,
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
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.82),
  );
  if (!blob) throw new Error("PHOTO_CONVERSION_FAILED");
  return new File([blob], `gluecksmoment-${Date.now()}.webp`, {
    type: "image/webp",
  });
}

export default function RewardCamera({ onChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const setPhoto = (file: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const nextUrl = file ? URL.createObjectURL(file) : null;
    setSelectedFile(file);
    setPreviewUrl(nextUrl);
    onChange(null, null);
  };

  const openCamera = async () => {
    setError("");
    setPhoto(null);
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      }, 0);
    } catch {
      setError("Kamera açılamadı. Telefonun kamera seçimini kullanabilirsin.");
      inputRef.current?.click();
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight || busy) return;
    setBusy(true);
    try {
      const file = await canvasFileFromSource(video, video.videoWidth, video.videoHeight);
      stopCamera();
      setPhoto(file);
    } catch {
      setError("Fotoğraf hazırlanamadı. Lütfen tekrar dene.");
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
    } catch {
      setError("Bu fotoğraf kullanılamadı. Lütfen tekrar çek.");
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (previewUrl && selectedFile) {
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-3xl border border-amber-300/40 bg-black">
          <img
            src={previewUrl}
            alt="Fotoğraf önizlemesi"
            className="aspect-square w-full object-cover"
          />
        </div>
        <p className="text-center text-sm font-bold text-white">Gefällt dir dein Foto?</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void openCamera()}
            className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 font-black text-white"
          >
            🔄 Nochmal aufnehmen
          </button>
          <button
            type="button"
            className="rounded-2xl bg-emerald-400 px-4 py-3 font-black text-black"
            onClick={() => onChange(selectedFile, previewUrl)}
          >
            ✓ Foto verwenden
          </button>
        </div>
        <button
          type="button"
          onClick={() => setPhoto(null)}
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
            <strong>Dein Glücksfoto</strong>
            <button type="button" onClick={stopCamera} className="rounded-full bg-white/15 px-4 py-2">
              ✕
            </button>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full -scale-x-100 object-cover"
            />
            <div className="pointer-events-none absolute inset-8 rounded-[2.5rem] border-2 border-white/50" />
          </div>
          <div className="grid place-items-center p-6">
            <button
              type="button"
              onClick={() => void capture()}
              disabled={busy}
              aria-label="Fotoğraf çek"
              className="h-20 w-20 rounded-full border-[7px] border-white bg-amber-400 shadow-2xl disabled:opacity-50"
            />
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

      {error ? <p className="text-sm text-amber-200">{error}</p> : null}
    </div>
  );
}
