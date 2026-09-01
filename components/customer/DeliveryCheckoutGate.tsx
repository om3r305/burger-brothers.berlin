"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCart } from "@/components/store";
import { getPricingOverrides } from "@/lib/settings";

const CUSTOMER_MENU_PATHS = new Set([
  "/menu",
  "/extras",
  "/drinks",
  "/sauces",
  "/hotdogs",
  "/donuts",
  "/bubble-tea",
]);

const CHECKOUT_PROFILE_KEY = "bb_checkout_profile_v2";
const CHECKOUT_INFO_KEY = "bb_checkout_info_v1";
const SELECTED_ADDRESS_KEY = "bb_selected_delivery_address_v1";
const NEW_ADDRESS_KEY = "bb_checkout_new_delivery_address_v1";

type Address = {
  id: string;
  label: "Zuhause" | "Arbeit" | "Andere";
  street: string;
  house: string;
  zip: string;
  city: string;
};

type GateView = "form" | "outside";

function cleanZip(value: unknown) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function readRecord(key: string) {
  try {
    return recordValue(JSON.parse(localStorage.getItem(key) || "null"));
  } catch {
    return {};
  }
}

function readRememberedAddress(): Address | null {
  const fromProfile = readRecord(`${CHECKOUT_PROFILE_KEY}:delivery`);
  const checkout = readRecord(CHECKOUT_INFO_KEY);
  const fromCheckout = recordValue(checkout.addr);
  const raw = fromProfile.street && fromProfile.house ? fromProfile : fromCheckout;

  const street = String(raw.street || "").trim();
  const house = String(raw.house || raw.houseNo || "").trim();
  const zip = cleanZip(raw.zip || raw.plz);
  const city = String(raw.city || "Berlin").trim() || "Berlin";
  if (!street || !house || zip.length !== 5) return null;

  const labelRaw = String(raw.addressLabel || raw.label || "Zuhause");
  const label: Address["label"] =
    labelRaw === "Arbeit" || labelRaw === "Andere" ? labelRaw : "Zuhause";
  return {
    id: `local:${zip}:${street.toLocaleLowerCase("de-DE")}:${house.toLocaleLowerCase("de-DE")}`,
    label,
    street,
    house,
    zip,
    city,
  };
}

function normalizedStreet(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/straße/g, "strasse")
    .replace(/\bstr\.?\b/g, "strasse")
    .replace(/[^a-z0-9]/g, "");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function checkoutButton(target: EventTarget | null) {
  const button = target instanceof Element ? target.closest("button") : null;
  if (!button) return null;
  const text = String(button.textContent || "").replace(/\s+/g, " ").trim();
  return text.includes("Weiter zur Kasse") || text === "Zur Kasse" ? button : null;
}

export default function DeliveryCheckoutGate() {
  const pathname = usePathname();
  const router = useRouter();
  const orderMode = useCart((state) => state.orderMode);
  const setOrderMode = useCart((state) => state.setOrderMode);
  const setPLZ = useCart((state) => state.setPLZ);
  const isMenuPath = CUSTOMER_MENU_PATHS.has(pathname);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<GateView>("form");
  const [currentAddress, setCurrentAddress] = useState<Address | null>(null);
  const [label, setLabel] = useState<Address["label"]>("Zuhause");
  const [zip, setZip] = useState("");
  const [street, setStreet] = useState("");
  const [house, setHouse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const minimums = useMemo(() => {
    try {
      return getPricingOverrides("delivery").plzMin || {};
    } catch {
      return {} as Record<string, number>;
    }
  }, [open, pathname]);

  const minimum =
    zip.length === 5 && Object.prototype.hasOwnProperty.call(minimums, zip)
      ? Number(minimums[zip] || 0)
      : null;

  const isDeliverableZip = useCallback(
    (value: string) => {
      const code = cleanZip(value);
      return (
        code.length === 5 && Object.prototype.hasOwnProperty.call(minimums, code)
      );
    },
    [minimums],
  );

  const startForm = useCallback((address?: Address | null) => {
    setView("form");
    setError("");
    setLabel(address?.label || "Zuhause");
    setZip(address?.zip || "");
    setStreet(address?.street || "");
    setHouse(address?.house || "");
    setOpen(true);
  }, []);

  const persistAddress = useCallback(
    (address: Address) => {
      try {
        const profile = readRecord(`${CHECKOUT_PROFILE_KEY}:delivery`);
        const nextProfile = {
          ...profile,
          street: address.street,
          house: address.house,
          zip: address.zip,
          city: address.city,
          addressLabel: address.label,
        };
        localStorage.setItem(
          `${CHECKOUT_PROFILE_KEY}:delivery`,
          JSON.stringify(nextProfile),
        );
        localStorage.setItem(
          `${CHECKOUT_PROFILE_KEY}:delivery:${address.zip}`,
          JSON.stringify(nextProfile),
        );

        const checkout = readRecord(CHECKOUT_INFO_KEY);
        localStorage.setItem(
          CHECKOUT_INFO_KEY,
          JSON.stringify({
            ...checkout,
            orderMode: "delivery",
            addr: {
              ...recordValue(checkout.addr),
              street: address.street,
              house: address.house,
              zip: address.zip,
              city: address.city,
            },
          }),
        );
        localStorage.setItem(SELECTED_ADDRESS_KEY, address.id);
        localStorage.removeItem(NEW_ADDRESS_KEY);
      } catch {
        // Local persistence is convenience; checkout still receives the in-memory PLZ.
      }

      setPLZ(address.zip);
      window.dispatchEvent(
        new CustomEvent("bb:delivery-address-selected", {
          detail: address,
        }),
      );
    },
    [setPLZ],
  );

  useEffect(() => {
    if (!isMenuPath || orderMode !== "delivery") return;

    const onClickCapture = (event: MouseEvent) => {
      const button = checkoutButton(event.target);
      if (!button) return;

      const address = readRememberedAddress();
      if (address && isDeliverableZip(address.zip)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      setCurrentAddress(address);
      if (address) {
        setView("outside");
        setOpen(true);
      } else {
        startForm(null);
      }
    };

    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [isDeliverableZip, isMenuPath, orderMode, startForm]);

  useEffect(() => {
    if (!isMenuPath || orderMode !== "delivery") return;

    const makeDesktopCheckoutAddressable = () => {
      const address = readRememberedAddress();
      if (address && isDeliverableZip(address.zip)) return;

      for (const button of Array.from(
        document.querySelectorAll<HTMLButtonElement>("aside button"),
      )) {
        const text = String(button.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        if (text !== "Zur Kasse") continue;

        // Only mutate when the DOM actually needs a change. The previous
        // implementation rewrote the same attribute while observing all
        // attributes, which could keep the MutationObserver alive forever.
        if (button.disabled) button.disabled = false;
        if (button.dataset.bbAddressGateButton !== "1") {
          button.setAttribute("data-bb-address-gate-button", "1");
        }
      }
    };

    makeDesktopCheckoutAddressable();
    const observer = new MutationObserver(makeDesktopCheckoutAddressable);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    return () => observer.disconnect();
  }, [isDeliverableZip, isMenuPath, orderMode]);

  const validateStreet = useCallback(async (code: string, value: string) => {
    try {
      const response = await fetch("/data/streets.json", { cache: "force-cache" });
      if (!response.ok) return true;
      const data = await response.json();
      const list = Array.isArray(data?.[code]) ? data[code] : [];
      if (code === "13503") list.push("Alt-Heiligensee");
      const target = normalizedStreet(value);
      return list.some(
        (candidate: unknown) =>
          normalizedStreet(String(candidate || "")) === target,
      );
    } catch {
      return true;
    }
  }, []);

  const saveAndContinue = useCallback(async () => {
    if (busy) return;
    setError("");

    const code = cleanZip(zip);
    const streetValue = street.trim();
    const houseValue = house.trim();

    if (code.length !== 5 || !isDeliverableZip(code)) {
      setError(
        "Leider liefern wir nicht in diese Postleitzahl. Bitte ändere die Adresse oder wähle Abholung.",
      );
      return;
    }
    if (!streetValue || !houseValue) {
      setError("Bitte Straße und Hausnummer vollständig eingeben.");
      return;
    }

    setBusy(true);
    try {
      const streetOk = await validateStreet(code, streetValue);
      if (!streetOk) {
        setError("Bitte eine gültige Straße aus unserem Liefergebiet eingeben.");
        return;
      }

      const address: Address = {
        id: `local:${code}:${streetValue.toLocaleLowerCase("de-DE")}:${houseValue.toLocaleLowerCase("de-DE")}`,
        label,
        street: streetValue,
        house: houseValue,
        zip: code,
        city: "Berlin",
      };
      persistAddress(address);
      setCurrentAddress(address);
      setOpen(false);
      router.push("/checkout");
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    house,
    isDeliverableZip,
    label,
    persistAddress,
    router,
    street,
    validateStreet,
    zip,
  ]);

  const switchToPickup = useCallback(() => {
    setOpen(false);
    setOrderMode("pickup");
    router.push("/checkout");
  }, [router, setOrderMode]);

  if (!isMenuPath || orderMode !== "delivery") return null;

  return (
    <>
      <style jsx global>{`
        [data-bb-address-gate-button="1"] {
          opacity: 1 !important;
          cursor: pointer !important;
        }
      `}</style>

      {open && (
        <div
          data-bb-swipe-ignore
          className="fixed inset-0 z-[140] flex items-end justify-center bg-black/75 p-3 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Lieferadresse prüfen"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-black">📍 Lieferadresse</div>
                <div className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Du kannst die Speisekarte frei ansehen. Die Adresse brauchen wir erst, bevor du zur Kasse gehst.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 text-zinc-400"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            {view === "outside" ? (
              <div className="mt-4">
                <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4">
                  <div className="font-bold text-rose-200">
                    Leider außerhalb unseres Liefergebiets
                  </div>
                  {currentAddress && (
                    <div className="mt-2 text-sm text-zinc-300">
                      {currentAddress.street} {currentAddress.house},{" "}
                      {currentAddress.zip} {currentAddress.city}
                    </div>
                  )}
                  <div className="mt-2 text-xs leading-relaxed text-zinc-400">
                    Bitte wähle eine andere Lieferadresse oder bestelle zur Abholung.
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => startForm(currentAddress)}
                    className="rounded-2xl bg-amber-300 px-3 py-3 text-sm font-black text-black"
                  >
                    Adresse ändern
                  </button>
                  <button
                    type="button"
                    onClick={switchToPickup}
                    className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-bold text-white"
                  >
                    Abholung wählen
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {(["Zuhause", "Arbeit", "Andere"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLabel(value)}
                      className={`rounded-xl border px-2 py-2 text-xs font-bold ${
                        label === value
                          ? "border-amber-300/50 bg-amber-300/10 text-amber-100"
                          : "border-white/10 bg-white/[0.04] text-zinc-300"
                      }`}
                    >
                      {value === "Zuhause"
                        ? "🏠"
                        : value === "Arbeit"
                          ? "💼"
                          : "📍"}{" "}
                      {value}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-[110px_1fr] gap-2">
                  <div>
                    <label
                      className="mb-1 block text-xs text-zinc-400"
                      htmlFor="bb-gate-zip"
                    >
                      PLZ
                    </label>
                    <input
                      id="bb-gate-zip"
                      inputMode="numeric"
                      value={zip}
                      onChange={(event) => {
                        setZip(cleanZip(event.target.value));
                        setError("");
                      }}
                      maxLength={5}
                      placeholder="13507"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 outline-none focus:border-amber-300/50"
                    />
                  </div>
                  <div>
                    <label
                      className="mb-1 block text-xs text-zinc-400"
                      htmlFor="bb-gate-street"
                    >
                      Straße
                    </label>
                    <input
                      id="bb-gate-street"
                      value={street}
                      onChange={(event) => {
                        setStreet(event.target.value);
                        setError("");
                      }}
                      placeholder="Namslaustraße"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 outline-none focus:border-amber-300/50"
                    />
                  </div>
                </div>

                <div>
                  <label
                    className="mb-1 block text-xs text-zinc-400"
                    htmlFor="bb-gate-house"
                  >
                    Hausnummer
                  </label>
                  <input
                    id="bb-gate-house"
                    value={house}
                    onChange={(event) => {
                      setHouse(event.target.value);
                      setError("");
                    }}
                    placeholder="81"
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 outline-none focus:border-amber-300/50"
                  />
                </div>

                {zip.length === 5 && minimum !== null && (
                  <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
                    ✓ Lieferung möglich · Mindestbestellwert {formatMoney(minimum)}
                  </div>
                )}
                {zip.length === 5 && minimum === null && (
                  <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                    Diese PLZ liegt außerhalb unseres Liefergebiets.
                  </div>
                )}
                {error && (
                  <div className="text-xs font-semibold leading-relaxed text-rose-300">
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void saveAndContinue()}
                  disabled={busy}
                  className="w-full rounded-2xl bg-amber-300 px-4 py-3 text-sm font-black text-black disabled:opacity-50"
                >
                  {busy ? "Adresse wird geprüft …" : "Adresse prüfen & weiter"}
                </button>

                <button
                  type="button"
                  onClick={switchToPickup}
                  className="w-full py-2 text-xs font-semibold text-zinc-400"
                >
                  Lieber zur Abholung bestellen
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
