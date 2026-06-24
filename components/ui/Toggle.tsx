// components/ui/Toggle.tsx
"use client";

import { useId } from "react";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  label?: string;
};

export default function Toggle({ checked, onChange, size = "md", disabled, label }: Props) {
  const id = useId();
  const dims =
    size === "sm"
      ? { w: 36, h: 20, knob: 16, shift: 16 }
      : size === "lg"
      ? { w: 56, h: 30, knob: 26, shift: 26 }
      : { w: 44, h: 24, knob: 20, shift: 20 };

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="inline-flex items-center outline-none transition"
      style={{
        width: dims.w,
        height: dims.h,
        borderRadius: 9999,
        border: "1px solid rgba(120,113,108,.6)",
        background: checked ? "linear-gradient(to bottom, #ffa94d, #ff8a1a)" : "rgba(68,64,60,.6)",
        boxShadow: checked
          ? "0 8px 18px rgba(255,140,40,.35), inset 0 1px 0 rgba(255,235,180,.85)"
          : "inset 0 1px 0 rgba(255,255,255,.06)",
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        position: "relative",
      }}
    >
      <span
        aria-hidden
        className="transition"
        style={{
          position: "absolute",
          width: dims.knob,
          height: dims.knob,
          left: 2,
          top: 2,
          borderRadius: "9999px",
          background: "#fff",
          transform: checked ? `translateX(${dims.shift}px)` : "translateX(0)",
        }}
      />
    </button>
  );
}
