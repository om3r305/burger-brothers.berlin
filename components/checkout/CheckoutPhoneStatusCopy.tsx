"use client";

import { useEffect } from "react";

const LEGACY_OK_TEXT = "Telefonnummer ist korrekt.";
const FORMAT_OK_TEXT = "Telefonnummer hat ein gültiges Format.";
const VERIFIED_TEXT = "✓ Telefonnummer bestätigt";
const INVALID_TEXT = "Bitte gib eine gültige deutsche Telefonnummer ein.";

function normalizeGermanPhone(raw: string) {
  const compact = String(raw || "").replace(/[^\d+]/g, "");
  let national = "";

  if (compact.startsWith("+49")) {
    national = `0${compact.slice(3).replace(/\D/g, "")}`;
  } else if (compact.startsWith("0049")) {
    national = `0${compact.slice(4).replace(/\D/g, "")}`;
  } else {
    const digits = compact.replace(/\D/g, "");
    national = digits.startsWith("49") && !digits.startsWith("049")
      ? `0${digits.slice(2)}`
      : digits;
  }

  if (!/^0\d+$/.test(national)) return null;
  if (national.length < 8 || national.length > 13) return null;

  // Reject obvious placeholder / repeated-digit garbage before any paid lookup.
  if (/^0(?:0|1{5,}|2{6,}|9{6,})/.test(national)) return null;
  if (/^0(\d)\1{6,}$/.test(national)) return null;

  // Plausible German mobile or geographic/service area prefix.
  if (!/^0(?:1[5-7]|2\d|3\d|4\d|5\d|6\d|7\d|8\d|9\d)/.test(national)) {
    return null;
  }

  return `+49${national.slice(1)}`;
}

function findPhoneHint() {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("p, span, small, div"),
  );

  return (
    candidates.find((element) => {
      if (element.childElementCount > 0) return false;
      const text = String(element.textContent || "").trim();
      return (
        text === LEGACY_OK_TEXT ||
        text === FORMAT_OK_TEXT ||
        text === VERIFIED_TEXT ||
        text === INVALID_TEXT
      );
    }) || null
  );
}

function applyInputTone(input: HTMLInputElement, valid: boolean) {
  const emerald = [
    "border-emerald-500/70",
    "bg-emerald-500/10",
    "ring-emerald-500/30",
    "focus:border-emerald-400",
  ];
  const rose = [
    "border-rose-500/70",
    "bg-rose-500/10",
    "ring-rose-500/25",
    "focus:border-rose-400",
  ];

  for (const className of [...emerald, ...rose]) {
    input.classList.remove(className);
  }
  for (const className of valid ? emerald : rose) {
    input.classList.add(className);
  }
}

function applyHintTone(hint: HTMLElement, valid: boolean) {
  hint.classList.remove("text-emerald-300", "text-rose-300");
  hint.classList.add(valid ? "text-emerald-300" : "text-rose-300");
}

export default function CheckoutPhoneStatusCopy() {
  useEffect(() => {
    let frame = 0;

    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const input = document.getElementById(
          "checkout-phone",
        ) as HTMLInputElement | null;
        if (!input) return;

        const raw = String(input.value || "").trim();
        const plausible = Boolean(normalizeGermanPhone(raw));
        const verified =
          plausible &&
          input.readOnly &&
          input.getAttribute("aria-readonly") === "true";

        input.setCustomValidity(raw && !plausible ? INVALID_TEXT : "");
        input.setAttribute("aria-invalid", plausible ? "false" : "true");
        applyInputTone(input, plausible);

        const hint = findPhoneHint();
        if (!hint) return;

        const nextText = verified
          ? VERIFIED_TEXT
          : plausible
            ? FORMAT_OK_TEXT
            : INVALID_TEXT;
        if (String(hint.textContent || "").trim() !== nextText) {
          hint.textContent = nextText;
        }
        applyHintTone(hint, plausible);
      });
    };

    const onInput = () => sync();
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["readonly", "aria-readonly"],
    });

    sync();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
    };
  }, []);

  return null;
}
