"use client";

import { useEffect } from "react";

export default function ShowcaseAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[showcase-admin:error-boundary]", error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <div className="max-w-xl rounded-2xl border border-red-700/50 bg-red-950/35 p-6 text-center shadow-2xl">
        <div className="text-4xl">🛠️</div>
        <h1 className="mt-3 text-xl font-black text-white">Showcase editörü korunarak durduruldu</h1>
        <p className="mt-2 text-sm leading-relaxed text-red-100">
          Bir sahnenin editörü beklenmeyen hata verdi. Yayındaki TV ekranları etkilenmez. Sayfayı yeniden oluşturmak için aşağıdaki düğmeyi kullan.
        </p>
        <button type="button" onClick={reset} className="mt-5 rounded-xl bg-red-500 px-5 py-2.5 text-sm font-black text-white hover:bg-red-400">
          Editörü yeniden yükle
        </button>
      </div>
    </div>
  );
}
