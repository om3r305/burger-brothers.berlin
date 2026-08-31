"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useCart } from "@/components/store";

const CUSTOMER_MENU_PATHS = new Set([
  "/menu",
  "/extras",
  "/drinks",
  "/sauces",
  "/hotdogs",
  "/donuts",
  "/bubble-tea",
]);

const SELECTED_ADDRESS_KEY = "bb_selected_delivery_address_v1";
const CHECKOUT_PROFILE_KEY = "bb_checkout_profile_v2";
const CHECKOUT_INFO_KEY = "bb_checkout_info_v1";
const ADDRESS_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

type SavedAddress = {
  id: string;
  label: string;
  street: string;
  house: string;
  zip: string;
  city: string;
  deliveryHint?: string;
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type SessionState = {
  enabled: boolean;
  trusted: boolean;
  addresses: SavedAddress[];
};

function confirmationKey(addressId: string) {
  return `bb_delivery_address_confirmed_v1:${addressId}`;
}

function parseTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readJsonRecord(key: string): Record<string, unknown> {
  try {
    return recordValue(JSON.parse(localStorage.getItem(key) || "null"));
  } catch {
    return {};
  }
}

function cleanZip(value: unknown) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function localAddressFromRecord(
  raw: Record<string, unknown>,
  label = "Letzte Lieferadresse",
): SavedAddress | null {
  const street = String(raw.street || "").trim();
  const house = String(raw.house || raw.houseNo || "").trim();
  const zip = cleanZip(raw.zip || raw.plz);
  const city = String(raw.city || "Berlin").trim() || "Berlin";

  if (!street || !house || zip.length !== 5) return null;

  return {
    id: `local:${zip}:${street.toLocaleLowerCase("de-DE")}:${house.toLocaleLowerCase("de-DE")}`,
    label,
    street,
    house,
    zip,
    city,
    deliveryHint:
      typeof raw.deliveryHint === "string"
        ? raw.deliveryHint
        : typeof raw.note === "string"
          ? raw.note
          : undefined,
  };
}

function readRememberedCheckoutAddress(): SavedAddress | null {
  try {
    const profile = localAddressFromRecord(
      readJsonRecord(`${CHECKOUT_PROFILE_KEY}:delivery`),
    );
    if (profile) return profile;

    const checkout = readJsonRecord(CHECKOUT_INFO_KEY);
    const checkoutAddress = localAddressFromRecord(
      recordValue(checkout.addr),
      "Letzte Lieferadresse",
    );
    if (checkoutAddress) return checkoutAddress;
  } catch {
    // Local checkout history is an optional fallback only.
  }

  return null;
}

function sameAddress(left: SavedAddress, right: SavedAddress) {
  return (
    cleanZip(left.zip) === cleanZip(right.zip) &&
    left.street.trim().toLocaleLowerCase("de-DE") ===
      right.street.trim().toLocaleLowerCase("de-DE") &&
    left.house.replace(/\s+/g, "").toLocaleLowerCase("de-DE") ===
      right.house.replace(/\s+/g, "").toLocaleLowerCase("de-DE")
  );
}

function persistCheckoutAddress(address: SavedAddress) {
  try {
    const base = readJsonRecord(`${CHECKOUT_PROFILE_KEY}:delivery`);
    const next = {
      ...base,
      street: address.street,
      house: address.house,
      zip: address.zip,
      city: address.city || "Berlin",
      deliveryHint:
        typeof address.deliveryHint === "string"
          ? address.deliveryHint
          : base.deliveryHint,
    };

    localStorage.setItem(
      `${CHECKOUT_PROFILE_KEY}:delivery`,
      JSON.stringify(next),
    );
    localStorage.setItem(
      `${CHECKOUT_PROFILE_KEY}:delivery:${address.zip}`,
      JSON.stringify(next),
    );
  } catch {
    // Address persistence is a convenience only; the server copy stays authoritative.
  }
}

function addressLabel(address: SavedAddress) {
  return `${address.street} ${address.house}, ${address.zip} ${address.city || "Berlin"}`;
}

export default function DeliveryAddressEntry() {
  const pathname = usePathname();
  const orderMode = useCart((state) => state.orderMode);
  const setPLZ = useCart((state) => state.setPLZ);
  const [session, setSession] = useState<SessionState>({
    enabled: false,
    trusted: false,
    addresses: [],
  });
  const [localAddress, setLocalAddress] = useState<SavedAddress | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [recheckOpen, setRecheckOpen] = useState(false);
  const [ready, setReady] = useState(false);

  const selectAddress = useCallback(
    (address: SavedAddress, confirmNow = false) => {
      setSelectedId(address.id);
      setPLZ(address.zip);
      persistCheckoutAddress(address);

      try {
        localStorage.setItem(SELECTED_ADDRESS_KEY, address.id);
        if (confirmNow) {
          localStorage.setItem(confirmationKey(address.id), String(Date.now()));
        }
      } catch {
        // Keep the in-memory selection usable when storage is unavailable.
      }

      window.dispatchEvent(
        new CustomEvent("bb:delivery-address-selected", {
          detail: { addressId: address.id, zip: address.zip },
        }),
      );
    },
    [setPLZ],
  );

  useEffect(() => {
    if (!CUSTOMER_MENU_PATHS.has(pathname) || orderMode !== "delivery") {
      setReady(false);
      setLocalAddress(null);
      setChooserOpen(false);
      setRecheckOpen(false);
      return;
    }

    let active = true;
    const remembered = readRememberedCheckoutAddress();

    if (remembered) {
      setLocalAddress(remembered);
      selectAddress(remembered, false);
      setReady(true);
    } else {
      setLocalAddress(null);
    }

    void (async () => {
      try {
        const response = await fetch("/customer-identity/session", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = await response.json().catch(() => null);
        if (!active || !response.ok || !data?.ok) return;

        const addresses = Array.isArray(data.addresses)
          ? (data.addresses as SavedAddress[])
          : [];
        const next: SessionState = {
          enabled: data.enabled !== false,
          trusted: data.trusted === true,
          addresses,
        };
        setSession(next);

        if (!next.enabled || !next.trusted || addresses.length === 0) return;

        let persistedId = "";
        try {
          persistedId = localStorage.getItem(SELECTED_ADDRESS_KEY) || "";
        } catch {}

        const selected =
          addresses.find((address) => address.id === persistedId) ||
          addresses.find((address) => address.isDefault) ||
          addresses[0];

        selectAddress(selected, false);

        let confirmedAt = 0;
        try {
          confirmedAt = Number(
            localStorage.getItem(confirmationKey(selected.id)) || 0,
          );
        } catch {}

        const addressUpdatedAt = Math.max(
          parseTimestamp(selected.updatedAt),
          parseTimestamp(selected.createdAt),
        );
        const lastConfirmedAt = Math.max(confirmedAt, addressUpdatedAt);

        if (
          lastConfirmedAt > 0 &&
          Date.now() - lastConfirmedAt >= ADDRESS_RECHECK_MS
        ) {
          setRecheckOpen(true);
        }
      } catch (error) {
        console.error("[delivery-address-entry] session failed", error);
      } finally {
        if (active) setReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [orderMode, pathname, selectAddress]);

  const availableAddresses = useMemo(() => {
    const serverAddresses = session.trusted ? session.addresses : [];
    if (!localAddress) return serverAddresses;
    if (serverAddresses.some((address) => sameAddress(address, localAddress))) {
      return serverAddresses;
    }
    return [...serverAddresses, localAddress];
  }, [localAddress, session.addresses, session.trusted]);

  const selected = useMemo(
    () =>
      availableAddresses.find((address) => address.id === selectedId) ||
      availableAddresses.find((address) => address.isDefault) ||
      availableAddresses[0] ||
      null,
    [availableAddresses, selectedId],
  );

  if (
    !ready ||
    orderMode !== "delivery" ||
    !CUSTOMER_MENU_PATHS.has(pathname) ||
    !selected
  ) {
    return null;
  }

  return (
    <>
      <div
        data-bb-swipe-ignore
        data-bb-delivery-address-entry="1"
        className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+142px)] z-[44] w-[min(92vw,460px)] -translate-x-1/2 sm:top-[calc(env(safe-area-inset-top)+98px)]"
      >
        <button
          type="button"
          onClick={() => setChooserOpen(true)}
          className="mx-auto flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-black/88 px-3 py-2 text-left text-xs text-white shadow-[0_12px_34px_rgba(0,0,0,.4)] backdrop-blur-xl transition hover:border-amber-300/40"
          aria-label="Lieferadresse auswählen"
        >
          <span aria-hidden className="text-sm">📍</span>
          <span className="min-w-0">
            <span className="block truncate font-extrabold text-amber-200">
              {selected.label || "Lieferadresse"}
            </span>
            <span className="block max-w-[68vw] truncate text-[11px] text-zinc-300 sm:max-w-[330px]">
              {addressLabel(selected)}
            </span>
          </span>
          <span aria-hidden className="ml-1 text-amber-300">⌄</span>
        </button>
      </div>

      {chooserOpen && (
        <div
          data-bb-swipe-ignore
          className="fixed inset-0 z-[115] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Lieferadresse auswählen"
          onClick={() => setChooserOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-4 text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-black">Wohin sollen wir liefern?</div>
                <div className="text-xs text-zinc-400">Gespeicherte Adresse auswählen</div>
              </div>
              <button
                type="button"
                className="rounded-full p-2 text-zinc-400"
                onClick={() => setChooserOpen(false)}
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              {availableAddresses.map((address) => {
                const active = address.id === selected.id;
                return (
                  <button
                    key={address.id}
                    type="button"
                    onClick={() => {
                      selectAddress(address, true);
                      setRecheckOpen(false);
                      setChooserOpen(false);
                    }}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      active
                        ? "border-amber-300/45 bg-amber-300/10"
                        : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm">{address.label || "Adresse"}</strong>
                      {active && (
                        <span className="text-[11px] font-bold text-amber-300">✓ Ausgewählt</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">
                      {addressLabel(address)}
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              Eine neue Adresse kannst du beim Checkout eingeben und anschließend speichern.
            </p>
          </div>
        </div>
      )}

      {recheckOpen && (
        <div
          data-bb-swipe-ignore
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Adresse bestätigen"
        >
          <div className="w-full max-w-sm rounded-3xl border border-amber-300/20 bg-zinc-950 p-5 text-white shadow-2xl">
            <div className="text-lg font-black">Ist diese Adresse noch aktuell?</div>
            <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="text-sm font-bold text-amber-200">
                {selected.label || "Lieferadresse"}
              </div>
              <div className="mt-1 text-sm text-zinc-300">{addressLabel(selected)}</div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  selectAddress(selected, true);
                  setRecheckOpen(false);
                }}
                className="rounded-2xl bg-amber-300 px-4 py-3 text-sm font-black text-black"
              >
                Ja, stimmt
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecheckOpen(false);
                  setChooserOpen(true);
                }}
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-bold text-white"
              >
                Ändern
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
