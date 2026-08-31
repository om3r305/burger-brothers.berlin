"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
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

const CHECKOUT_PATH = "/checkout";
const SELECTED_ADDRESS_KEY = "bb_selected_delivery_address_v1";
const CHECKOUT_PROFILE_KEY = "bb_checkout_profile_v2";
const CHECKOUT_INFO_KEY = "bb_checkout_info_v1";
const NEW_ADDRESS_KEY = "bb_checkout_new_delivery_address_v1";
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
  fallbackLabel = "Letzte Lieferadresse",
): SavedAddress | null {
  const street = String(raw.street || "").trim();
  const house = String(raw.house || raw.houseNo || "").trim();
  const zip = cleanZip(raw.zip || raw.plz);
  const city = String(raw.city || "Berlin").trim() || "Berlin";
  const label =
    String(raw.addressLabel || raw.label || fallbackLabel).trim().slice(0, 40) ||
    fallbackLabel;

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
      addressLabel: address.label || "Lieferadresse",
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

    const checkout = readJsonRecord(CHECKOUT_INFO_KEY);
    const checkoutAddr = recordValue(checkout.addr);
    localStorage.setItem(
      CHECKOUT_INFO_KEY,
      JSON.stringify({
        ...checkout,
        orderMode: "delivery",
        addr: {
          ...checkoutAddr,
          street: address.street,
          house: address.house,
          zip: address.zip,
          city: address.city || "Berlin",
        },
      }),
    );
  } catch {
    // Address persistence is a convenience only; the server copy stays authoritative.
  }
}

function addressLabel(address: SavedAddress) {
  return `${address.street} ${address.house}, ${address.zip} ${address.city || "Berlin"}`;
}

function addressIcon(label: string) {
  const value = String(label || "").trim().toLocaleLowerCase("de-DE");
  if (value.includes("zuhause") || value.includes("home") || value.includes("wohn")) {
    return "🏠";
  }
  if (value.includes("arbeit") || value.includes("work") || value.includes("büro")) {
    return "💼";
  }
  return "📍";
}

function markCheckoutAddressRows(hidden: boolean) {
  const ids = ["checkout-zip", "checkout-house", "checkout-entrance"];

  for (const id of ids) {
    const input = document.getElementById(id);
    const row = input?.closest("div.grid.grid-cols-2");
    if (!row) continue;
    if (hidden) row.setAttribute("data-bb-checkout-address-hidden", "1");
    else row.removeAttribute("data-bb-checkout-address-hidden");
  }

  const locationButton = Array.from(document.querySelectorAll("button")).find((button) => {
    const text = String(button.textContent || "");
    return text.includes("Meinen Standort verwenden") || text.includes("Standort wird ermittelt");
  });
  const locationSection = locationButton?.parentElement;
  if (locationSection) {
    if (hidden) locationSection.setAttribute("data-bb-checkout-address-hidden", "1");
    else locationSection.removeAttribute("data-bb-checkout-address-hidden");
  }

  return {
    anchor:
      locationSection ||
      document.getElementById("checkout-zip")?.closest("div.grid.grid-cols-2") ||
      null,
  };
}

export default function DeliveryAddressEntry() {
  const pathname = usePathname();
  const router = useRouter();
  const orderMode = useCart((state) => state.orderMode);
  const setPLZ = useCart((state) => state.setPLZ);
  const isMenuPath = CUSTOMER_MENU_PATHS.has(pathname);
  const isCheckoutPath = pathname === CHECKOUT_PATH;
  const isAddressSurface = isMenuPath || isCheckoutPath;

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
  const [labelBusy, setLabelBusy] = useState(false);
  const [checkoutManualAddress, setCheckoutManualAddress] = useState(false);
  const [checkoutHost, setCheckoutHost] = useState<HTMLElement | null>(null);

  const selectAddress = useCallback(
    (address: SavedAddress, confirmNow = false) => {
      setSelectedId(address.id);
      setPLZ(address.zip);
      persistCheckoutAddress(address);
      setCheckoutManualAddress(false);

      try {
        localStorage.setItem(SELECTED_ADDRESS_KEY, address.id);
        localStorage.removeItem(NEW_ADDRESS_KEY);
        if (confirmNow) {
          localStorage.setItem(confirmationKey(address.id), String(Date.now()));
        }
      } catch {
        // Keep the in-memory selection usable when storage is unavailable.
      }

      window.dispatchEvent(
        new CustomEvent("bb:delivery-address-selected", {
          detail: {
            addressId: address.id,
            zip: address.zip,
            street: address.street,
            house: address.house,
            city: address.city || "Berlin",
            label: address.label,
          },
        }),
      );
    },
    [setPLZ],
  );

  useEffect(() => {
    if (!isAddressSurface || orderMode !== "delivery") {
      setReady(false);
      setLocalAddress(null);
      setChooserOpen(false);
      setRecheckOpen(false);
      setCheckoutHost(null);
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

    if (isCheckoutPath) {
      try {
        setCheckoutManualAddress(localStorage.getItem(NEW_ADDRESS_KEY) === "1");
      } catch {
        setCheckoutManualAddress(false);
      }
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

        if (!isCheckoutPath || !checkoutManualAddress) {
          selectAddress(selected, false);
        }

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
  }, [
    checkoutManualAddress,
    isAddressSurface,
    isCheckoutPath,
    orderMode,
    selectAddress,
  ]);

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

  const renameSelectedAddress = useCallback(
    async (label: "Zuhause" | "Arbeit" | "Andere") => {
      if (!selected || labelBusy) return;
      setLabelBusy(true);

      try {
        if (selected.id.startsWith("local:")) {
          const next = { ...selected, label };
          setLocalAddress(next);
          persistCheckoutAddress(next);
          return;
        }

        const response = await fetch("/api/customer-identity/addresses", {
          method: "PATCH",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ id: selected.id, label }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok || !Array.isArray(data.addresses)) return;

        setSession((current) => ({
          ...current,
          addresses: data.addresses as SavedAddress[],
        }));

        const updated = (data.addresses as SavedAddress[]).find(
          (address) => address.id === selected.id,
        );
        if (updated) persistCheckoutAddress(updated);
      } catch (error) {
        console.error("[delivery-address-entry] rename failed", error);
      } finally {
        setLabelBusy(false);
      }
    },
    [labelBusy, selected],
  );

  const beginNewAddress = useCallback(() => {
    setChooserOpen(false);
    setRecheckOpen(false);
    setCheckoutManualAddress(true);
    try {
      localStorage.setItem(NEW_ADDRESS_KEY, "1");
    } catch {}

    if (!isCheckoutPath) {
      router.push("/checkout?address=new");
    }
  }, [isCheckoutPath, router]);

  useEffect(() => {
    const openChooser = () => setChooserOpen(true);
    window.addEventListener(
      "bb:open-delivery-address-chooser",
      openChooser as EventListener,
    );
    return () =>
      window.removeEventListener(
        "bb:open-delivery-address-chooser",
        openChooser as EventListener,
      );
  }, []);

  useEffect(() => {
    if (!isCheckoutPath || orderMode !== "delivery" || !ready) {
      markCheckoutAddressRows(false);
      setCheckoutHost((current) => {
        current?.remove();
        return null;
      });
      return;
    }

    let stopped = false;

    const sync = () => {
      if (stopped) return;
      const { anchor } = markCheckoutAddressRows(Boolean(selected && !checkoutManualAddress));
      if (!anchor) return;

      let host = document.querySelector<HTMLElement>(
        "[data-bb-checkout-selected-address-host='1']",
      );
      if (!host) {
        host = document.createElement("div");
        host.setAttribute("data-bb-checkout-selected-address-host", "1");
        host.className = "md:col-span-2";
        anchor.parentElement?.insertBefore(host, anchor);
      }
      setCheckoutHost((current) => (current === host ? current : host));
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      stopped = true;
      observer.disconnect();
      markCheckoutAddressRows(false);
      const host = document.querySelector<HTMLElement>(
        "[data-bb-checkout-selected-address-host='1']",
      );
      host?.remove();
      setCheckoutHost(null);
    };
  }, [checkoutManualAddress, isCheckoutPath, orderMode, ready, selected]);

  if (!ready || orderMode !== "delivery" || !isAddressSurface) {
    return null;
  }

  return (
    <>
      <style jsx global>{`
        body:has([data-bb-selected-delivery-address="1"])
          [role="dialog"][aria-label="Bestellübersicht"]
          div:has(> label[for="m-plz"]),
        body:has([data-bb-selected-delivery-address="1"])
          aside
          div:has(> label[for="plz"]) {
          display: none !important;
        }

        [data-bb-checkout-address-hidden="1"] {
          display: none !important;
        }
      `}</style>

      {selected && (
        <span
          aria-hidden
          className="hidden"
          data-bb-selected-delivery-address="1"
        />
      )}

      {isMenuPath && selected && (
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
            <span aria-hidden className="text-sm">{addressIcon(selected.label)}</span>
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
      )}

      {isCheckoutPath && checkoutHost &&
        createPortal(
          selected && !checkoutManualAddress ? (
            <div className="mb-1 rounded-2xl border border-amber-300/35 bg-amber-300/10 p-4 text-white shadow-[0_12px_30px_rgba(0,0,0,.2)]">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-300/15 text-xl">
                  {addressIcon(selected.label)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-amber-200">
                    {selected.label || "Lieferadresse"}
                  </div>
                  <div className="mt-1 text-sm leading-relaxed text-stone-200">
                    {addressLabel(selected)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setChooserOpen(true)}
                      className="rounded-lg border border-amber-300/30 bg-black/20 px-3 py-2 text-xs font-bold text-amber-100"
                    >
                      Andere Adresse
                    </button>
                    <button
                      type="button"
                      onClick={beginNewAddress}
                      className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white"
                    >
                      + Neue Adresse
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-1 rounded-2xl border border-sky-400/25 bg-sky-400/10 p-3 text-sm text-sky-50">
              <div className="font-bold">Neue Lieferadresse</div>
              <div className="mt-1 text-xs text-stone-300">
                Adresse unten eingeben oder eine gespeicherte Adresse auswählen.
              </div>
              {selected && (
                <button
                  type="button"
                  onClick={() => {
                    selectAddress(selected, true);
                    setCheckoutManualAddress(false);
                  }}
                  className="mt-2 rounded-lg border border-sky-300/30 bg-black/20 px-3 py-2 text-xs font-bold text-sky-100"
                >
                  Gespeicherte Adresse verwenden
                </button>
              )}
            </div>
          ),
          checkoutHost,
        )}

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
                <div className="text-xs text-zinc-400">
                  Gespeicherte Adresse auswählen oder neue hinzufügen
                </div>
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
                const active = selected ? address.id === selected.id : false;
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
                      <strong className="flex items-center gap-2 text-sm">
                        <span aria-hidden>{addressIcon(address.label)}</span>
                        {address.label || "Adresse"}
                      </strong>
                      {active && (
                        <span className="text-[11px] font-bold text-amber-300">
                          ✓ Ausgewählt
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">
                      {addressLabel(address)}
                    </div>
                  </button>
                );
              })}
            </div>

            {selected && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                  Adressname
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["Zuhause", "Arbeit", "Andere"] as const).map((label) => (
                    <button
                      key={label}
                      type="button"
                      disabled={labelBusy}
                      onClick={() => void renameSelectedAddress(label)}
                      className={`rounded-xl border px-2 py-2 text-xs font-bold transition disabled:opacity-50 ${
                        selected.label === label
                          ? "border-amber-300/45 bg-amber-300/10 text-amber-100"
                          : "border-white/10 bg-white/[0.04] text-zinc-200"
                      }`}
                    >
                      {label === "Zuhause" ? "🏠" : label === "Arbeit" ? "💼" : "📍"}{" "}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={beginNewAddress}
              className="mt-3 w-full rounded-2xl border border-amber-300/35 bg-amber-300/10 px-4 py-3 text-sm font-black text-amber-100 transition hover:bg-amber-300/15"
            >
              + Neue Adresse hinzufügen
            </button>

            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              Zuhause, Arbeit oder Andere kannst du jederzeit als Namen für die ausgewählte Adresse festlegen.
            </p>
          </div>
        </div>
      )}

      {recheckOpen && selected && (
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
