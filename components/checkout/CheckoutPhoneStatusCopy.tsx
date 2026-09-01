"use client";

import { useEffect } from "react";

const LEGACY_OK_TEXT = "Telefonnummer ist korrekt.";
const FORMAT_OK_TEXT = "Telefonnummer hat ein gültiges Format.";
const VERIFIED_TEXT = "✓ Telefonnummer bestätigt";

function findPhoneHint(input: HTMLInputElement) {
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
        text === VERIFIED_TEXT
      );
    }) || null
  );
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

        const hint = findPhoneHint(input);
        if (!hint) return;

        const verified =
          input.readOnly && input.getAttribute("aria-readonly") === "true";
        const nextText = verified ? VERIFIED_TEXT : FORMAT_OK_TEXT;
        if (String(hint.textContent || "").trim() !== nextText) {
          hint.textContent = nextText;
        }
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
