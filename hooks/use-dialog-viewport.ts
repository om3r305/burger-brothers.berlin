"use client";

import { useEffect, useState, type CSSProperties } from "react";

// Android's keyboard can resize only the visual viewport, leaving dvh unchanged.
export function useDialogViewport(open: boolean): CSSProperties {
  const [viewport, setViewport] = useState<CSSProperties>({});

  useEffect(() => {
    if (!open) return;
    const visual = window.visualViewport;
    const update = () => setViewport({
      "--bb-dialog-height": `${visual?.height ?? window.innerHeight}px`,
      "--bb-dialog-top": `${visual?.offsetTop ?? 0}px`,
    } as CSSProperties);
    update();
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  return viewport;
}
