"use client";
import { useEffect, useRef } from "react";

export default function Snow() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let w = (c.width = window.innerWidth);
    let h = (c.height = window.innerHeight);
    const flakes = Array.from({ length: Math.min(120, Math.floor(w/15)) }, () => ({
      x: Math.random()*w,
      y: Math.random()*h,
      r: 1 + Math.random()*2,
      s: 0.5 + Math.random()*0.8
    }));
    const onResize = () => { w = c.width = window.innerWidth; h = c.height = window.innerHeight; };
    window.addEventListener("resize", onResize);
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (const f of flakes) {
        f.y += f.s;
        f.x += Math.sin(f.y*0.01)*0.3;
        if (f.y > h) { f.y = -5; f.x = Math.random()*w; }
        ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,Math.PI*2); ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, []);
  return (
    <canvas
      ref={ref}
      style={{
        position:"fixed", inset:0, pointerEvents:"none", zIndex:50, opacity:0.6
      }}
      aria-hidden
    />
  );
}
