"use client";
import { useEffect, useRef } from "react";

export default function Snow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current!;
    const flakes = 80;
    const arr: HTMLSpanElement[] = [];
    for (let i = 0; i < flakes; i++) {
      const s = document.createElement("span");
      s.className = "snowflake";
      s.style.left = Math.random() * 100 + "vw";
      s.style.animationDelay = Math.random() * 8 + "s";
      s.style.fontSize = 8 + Math.random() * 12 + "px";
      s.textContent = "❄";
      root.appendChild(s);
      arr.push(s);
    }
    return () => { arr.forEach(n => n.remove()); };
  }, []);
  return <div ref={ref} className="snow-layer pointer-events-none" />;
}
