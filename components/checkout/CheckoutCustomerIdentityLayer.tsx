"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SavedAddress = {
  id: string;
  label: string;
  street: string;
  house: string;
  zip: string;
  city: string;
  deliveryHint?: string;
  isDefault?: boolean;
};

type SessionState = {
  enabled: boolean;
  trusted: boolean;
  orderProof?: string;
  customer?: { name?: string; phone?: string; phoneVerifiedAt?: string | null };
  addresses: SavedAddress[];
};

type PendingOrderFetch = {
  input: RequestInfo | URL;
  init?: RequestInit;
  payload: Record<string, any>;
  resolve: (response: Response) => void;
  reject: (reason?: unknown) => void;
};

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function comparablePhone(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0049")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `49${digits.slice(1)}`;
  return digits;
}

function setControlledInput(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function readInput(id: string) {
  return String(
    (document.getElementById(id) as HTMLInputElement | null)?.value || "",
  ).trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function requestWithProof(
  init: RequestInit | undefined,
  payload: Record<string, any>,
  orderProof: string,
): RequestInit {
  const wrappedOrder = asRecord(payload.order);
  const nextPayload = Object.keys(wrappedOrder).length
    ? {
        ...payload,
        order: {
          ...wrappedOrder,
          customerVerificationProof: orderProof,
        },
      }
    : {
        ...payload,
        customerVerificationProof: orderProof,
      };

  return {
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(nextPayload),
  };
}

export default function CheckoutCustomerIdentityLayer() {
  const [session, setSession] = useState<SessionState>({
    enabled: false,
    trusted: false,
    addresses: [],
  });
  const [ready, setReady] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [phoneEditing, setPhoneEditing] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpPhone, setOtpPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveLabel, setSaveLabel] = useState("Zuhause");
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const originalFetchRef = useRef<typeof window.fetch | null>(null);
  const pendingRef = useRef<PendingOrderFetch | null>(null);

  const applySessionPayload = useCallback((data: any) => {
    const next: SessionState = {
      enabled: data?.enabled !== false,
      trusted: data?.trusted === true,
      orderProof: String(data?.orderProof || "") || undefined,
      customer: data?.customer || undefined,
      addresses: Array.isArray(data?.addresses) ? data.addresses : [],
    };
    setSession(next);
    return next;
  }, []);

  const loadFreshSession = useCallback(async () => {
    const fetcher = originalFetchRef.current || window.fetch.bind(window);
    const response = await fetcher("/customer-identity/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) return null;
    return applySessionPayload(data);
  }, [applySessionPayload]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/customer-identity/session", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = await response.json().catch(() => null);
        if (active && response.ok && data?.ok) applySessionPayload(data);
      } catch (cause) {
        console.error("[checkout-identity] session failed", cause);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [applySessionPayload]);

  useEffect(() => {
    if (!ready || !session.trusted || phoneEditing) return;
    const apply = () => {
      const phone = document.getElementById("checkout-phone") as HTMLInputElement | null;
      if (!phone) return;
      const expected = String(session.customer?.phone || "");
      if (expected && comparablePhone(phone.value) !== comparablePhone(expected)) {
        setControlledInput("checkout-phone", expected);
      }
      phone.readOnly = true;
      phone.setAttribute("aria-readonly", "true");
    };
    apply();
    const timer = window.setInterval(apply, 800);
    return () => window.clearInterval(timer);
  }, [ready, session.trusted, session.customer?.phone, phoneEditing]);

  const startVerification = useCallback(async (payload: Record<string, any>) => {
    const order = Object.keys(asRecord(payload.order)).length
      ? asRecord(payload.order)
      : payload;
    const customer = asRecord(order.customer);
    const phone = String(customer.phone || order.phone || "");
    const address = {
      street: customer.street,
      house: customer.house || customer.houseNo,
      zip: customer.zip || customer.plz,
      city: customer.city || "Berlin",
      deliveryHint: customer.deliveryHint || customer.note,
      label: "Zuhause",
      isDefault: true,
    };

    setBusy(true);
    setError("");
    try {
      const fetcher = originalFetchRef.current || window.fetch.bind(window);
      const response = await fetcher("/customer-identity/verification/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          name: customer.name || order.customerName || "",
          address:
            String(order.mode || "").toLowerCase() === "delivery"
              ? address
              : null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(
          data?.message || "Die Telefonnummer konnte nicht bestätigt werden.",
        );
      }
      setOtpPhone(String(data.phoneE164 || phone));
      setOtpCode("");
      setOtpOpen(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !session.enabled || originalFetchRef.current) return;
    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (!url.includes("/api/orders/create")) {
        return originalFetch(input, init);
      }

      let payload: Record<string, any> = {};
      try {
        if (typeof init?.body === "string") payload = JSON.parse(init.body);
      } catch {
        return originalFetch(input, init);
      }

      const order = Object.keys(asRecord(payload.order)).length
        ? asRecord(payload.order)
        : payload;
      const customer = asRecord(order.customer);
      const orderPhone = comparablePhone(customer.phone || order.phone);
      const trustedPhone = comparablePhone(session.customer?.phone);

      if (
        session.trusted &&
        trustedPhone &&
        orderPhone === trustedPhone &&
        !phoneEditing
      ) {
        try {
          const fresh = await loadFreshSession();
          const freshPhone = comparablePhone(fresh?.customer?.phone);
          if (
            fresh?.trusted &&
            fresh?.orderProof &&
            freshPhone === orderPhone
          ) {
            return originalFetch(
              input,
              requestWithProof(init, payload, fresh.orderProof),
            );
          }
        } catch (cause) {
          console.error("[checkout-identity] fresh proof failed", cause);
        }
      }

      if (pendingRef.current) {
        throw new Error("Telefonbestätigung läuft bereits.");
      }

      return new Promise<Response>((resolve, reject) => {
        pendingRef.current = { input, init, payload, resolve, reject };
        void startVerification(payload).catch((cause) => {
          pendingRef.current = null;
          const message =
            cause instanceof Error
              ? cause.message
              : "Telefonbestätigung fehlgeschlagen.";
          setError(message);
          reject(cause);
        });
      });
    }) as typeof window.fetch;

    return () => {
      if (originalFetchRef.current) window.fetch = originalFetchRef.current;
      originalFetchRef.current = null;
    };
  }, [
    ready,
    session.enabled,
    session.trusted,
    session.customer?.phone,
    phoneEditing,
    loadFreshSession,
    startVerification,
  ]);

  const confirmOtp = useCallback(async () => {
    if (otpCode.replace(/\D/g, "").length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const fetcher = originalFetchRef.current || window.fetch.bind(window);
      const response = await fetcher("/customer-identity/verification/confirm", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: otpCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok || !data?.orderProof) {
        throw new Error(data?.message || "Der Code ist nicht korrekt.");
      }

      setSession({
        enabled: true,
        trusted: true,
        orderProof: String(data.orderProof),
        customer: { name: data.name, phone: data.phoneE164 },
        addresses: Array.isArray(data.addresses) ? data.addresses : [],
      });
      setPhoneEditing(false);
      setOtpOpen(false);

      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        try {
          pending.resolve(
            await fetcher(
              pending.input,
              requestWithProof(
                pending.init,
                pending.payload,
                String(data.orderProof),
              ),
            ),
          );
        } catch (cause) {
          pending.reject(cause);
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Bestätigung fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  }, [otpCode]);

  const applyAddress = useCallback(async (address: SavedAddress) => {
    setControlledInput("checkout-zip", address.zip);
    await sleep(180);
    setControlledInput("checkout-street", address.street);
    await sleep(120);
    setControlledInput("checkout-house", address.house);
  }, []);

  const saveCurrentAddress = useCallback(async () => {
    const street = readInput("checkout-street");
    const house = readInput("checkout-house");
    const zip = readInput("checkout-zip");
    if (!street || !house || !/^\d{5}$/.test(zip)) {
      setError("Bitte zuerst eine vollständige Lieferadresse eingeben.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fetcher = originalFetchRef.current || window.fetch.bind(window);
      const response = await fetcher("/customer-identity/addresses", {
        method: editingAddressId ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingAddressId ? { id: editingAddressId } : {}),
          label: saveLabel,
          street,
          house,
          zip,
          city: "Berlin",
          isDefault: session.addresses.length === 0,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error("Adresse konnte nicht gespeichert werden.");
      }
      setSession((current) => ({
        ...current,
        addresses: Array.isArray(data.addresses) ? data.addresses : [],
      }));
      setEditingAddressId(null);
      setSaveLabel("Zuhause");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Adresse konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }, [editingAddressId, saveLabel, session.addresses.length]);

  const deleteAddress = useCallback(async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const fetcher = originalFetchRef.current || window.fetch.bind(window);
      const response = await fetcher("/customer-identity/addresses", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error("Adresse konnte nicht gelöscht werden.");
      }
      setSession((current) => ({
        ...current,
        addresses: Array.isArray(data.addresses) ? data.addresses : [],
      }));
      if (editingAddressId === id) setEditingAddressId(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Adresse konnte nicht gelöscht werden.",
      );
    } finally {
      setBusy(false);
    }
  }, [editingAddressId]);

  const beginPhoneChange = useCallback(() => {
    setPhoneEditing(true);
    const phone = document.getElementById("checkout-phone") as HTMLInputElement | null;
    if (phone) {
      phone.readOnly = false;
      phone.removeAttribute("aria-readonly");
      phone.focus();
      phone.select();
    }
  }, []);

  if (!ready || !session.enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setPanelOpen((value) => !value)}
        className="fixed bottom-20 left-3 z-[75] rounded-full border border-amber-300/30 bg-black/90 px-4 py-2 text-xs font-semibold text-amber-200 shadow-2xl backdrop-blur md:bottom-5 md:left-5"
      >
        {session.trusted ? "✓ Kundendaten" : "Telefon-Schutz"}
      </button>

      {panelOpen && (
        <div className="fixed inset-x-3 bottom-32 z-[80] max-h-[70vh] overflow-auto rounded-3xl border border-white/10 bg-zinc-950/95 p-4 text-white shadow-2xl backdrop-blur md:bottom-16 md:left-5 md:right-auto md:w-[420px]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold">Kundendaten</div>
              <div className="text-xs text-zinc-400">Ohne Konto und Passwort</div>
            </div>
            <button type="button" onClick={() => setPanelOpen(false)} className="px-2 py-1 text-zinc-400">✕</button>
          </div>

          {session.trusted ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-3">
                <div className="text-xs text-emerald-300">Telefon bestätigt</div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <strong>{session.customer?.phone}</strong>
                  <button type="button" onClick={beginPhoneChange} className="text-xs font-semibold text-amber-300">Ändern</button>
                </div>
                {phoneEditing && <p className="mt-2 text-xs text-zinc-400">Die alte Nummer bleibt bestätigt, bis die neue Nummer per SMS bestätigt wurde.</p>}
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Gespeicherte Adressen</div>
                <div className="space-y-2">
                  {session.addresses.map((address) => (
                    <div key={address.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <button type="button" onClick={() => { void applyAddress(address); setPanelOpen(false); }} className="w-full text-left">
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-sm">{address.label || "Adresse"}</strong>
                          {address.isDefault && <span className="text-[10px] text-amber-300">Standard</span>}
                        </div>
                        <div className="mt-1 text-xs text-zinc-400">{address.street} {address.house}, {address.zip} {address.city}</div>
                      </button>
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => { setEditingAddressId(address.id); setSaveLabel(address.label || "Zuhause"); void applyAddress(address); setPanelOpen(false); }} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold">Ändern</button>
                        <button type="button" disabled={busy} onClick={() => void deleteAddress(address.id)} className="rounded-lg px-3 py-1.5 text-xs text-red-300 disabled:opacity-50">Löschen</button>
                      </div>
                    </div>
                  ))}
                  {!session.addresses.length && <div className="text-xs text-zinc-500">Noch keine Adresse gespeichert.</div>}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 p-3">
                <div className="mb-2 text-xs font-semibold">{editingAddressId ? "Geänderte Lieferadresse speichern" : "Aktuelle Lieferadresse speichern"}</div>
                <div className="mb-3 flex flex-wrap gap-2">
                  {["Zuhause", "Arbeit", "Andere"].map((label) => (
                    <button key={label} type="button" onClick={() => setSaveLabel(label)} className={`rounded-full px-3 py-1 text-xs ${saveLabel === label ? "bg-amber-300 text-black" : "bg-white/10 text-zinc-300"}`}>{label}</button>
                  ))}
                </div>
                <button type="button" disabled={busy} onClick={() => void saveCurrentAddress()} className="w-full rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15 disabled:opacity-50">{editingAddressId ? "Änderung speichern" : "+ Adresse speichern"}</button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-300">Bei deiner ersten Bestellung bestätigen wir die Telefonnummer einmalig per SMS. Danach bleibt sie auf diesem Gerät bestätigt.</p>
          )}
          {error && <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 p-2 text-xs text-red-200">{error}</div>}
        </div>
      )}

      {otpOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl">
            <div className="text-lg font-bold">Telefon bestätigen</div>
            <p className="mt-1 text-sm text-zinc-400">Wir haben einen 6-stelligen Code an <strong className="text-zinc-200">{otpPhone}</strong> gesendet.</p>
            <input autoFocus inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(event) => { if (event.key === "Enter") void confirmOtp(); }} placeholder="123456" className="mt-4 w-full rounded-2xl border border-white/15 bg-black px-4 py-3 text-center text-2xl tracking-[0.35em] outline-none focus:border-amber-300/60" />
            {error && <div className="mt-3 text-sm text-red-300">{error}</div>}
            <button type="button" disabled={busy || otpCode.length !== 6} onClick={() => void confirmOtp()} className="mt-4 w-full rounded-2xl bg-amber-300 px-4 py-3 font-bold text-black disabled:opacity-50">{busy ? "Prüfen…" : "Bestätigen & bestellen"}</button>
            <button type="button" disabled={busy} onClick={() => { const pending = pendingRef.current; pendingRef.current = null; pending?.reject(new Error("Telefonbestätigung abgebrochen.")); setOtpOpen(false); setError(""); }} className="mt-2 w-full px-4 py-2 text-sm text-zinc-500">Abbrechen</button>
          </div>
        </div>
      )}
    </>
  );
}
