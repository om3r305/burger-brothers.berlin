"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCart } from "@/components/store";
import { getPricingOverrides } from "@/lib/settings";
import {
  getStreets,
  hydrateFromBundledJSON,
  searchStreets,
  streetEquals,
} from "@/lib/streets";

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

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GoogleGeocoderResult = {
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
};

type GoogleGeocoder = {
  geocode: (
    request: { location: { lat: number; lng: number } },
    callback: (results: GoogleGeocoderResult[] | null, status: string) => void,
  ) => void;
};

type GoogleMapsApi = {
  Geocoder: new () => GoogleGeocoder;
};

type GoogleMapsWindow = Window & {
  google?: {
    maps?: GoogleMapsApi;
  };
};

type ReverseGeocodedAddress = {
  street: string;
  house: string;
  zip: string;
  city: string;
  country: string;
  formattedAddress: string;
  lat: number;
  lng: number;
};

type LocationSuggestion = ReverseGeocodedAddress & {
  officialStreet: string;
  accuracyMeters: number;
};

type AddressValidationResponse = {
  ok?: boolean;
  valid?: boolean;
  addressComplete?: boolean;
  hasUnconfirmedComponents?: boolean;
  street?: string;
  house?: string;
  zip?: string;
  city?: string;
  message?: string;
};

let googleMapsScriptPromise: Promise<GoogleMapsApi> | null = null;

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

function googleComponent(
  components: GoogleAddressComponent[] | undefined,
  type: string,
  short = false,
) {
  const component = (components || []).find((item) =>
    Array.isArray(item.types) ? item.types.includes(type) : false,
  );
  return String(short ? component?.short_name || "" : component?.long_name || "").trim();
}

function reverseGeocoderCity(components: GoogleAddressComponent[] | undefined) {
  return (
    googleComponent(components, "locality") ||
    googleComponent(components, "postal_town") ||
    googleComponent(components, "administrative_area_level_3") ||
    "Berlin"
  );
}

async function loadGoogleMapsForGeocoding(): Promise<GoogleMapsApi> {
  if (typeof window === "undefined") {
    throw new Error("Google Maps ist im Browser nicht verfügbar.");
  }

  const current = (window as GoogleMapsWindow).google?.maps;
  if (current?.Geocoder) return current;
  if (googleMapsScriptPromise) return googleMapsScriptPromise;

  const apiKey = String(
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY || "",
  ).trim();
  if (!apiKey) {
    throw new Error("Google Maps ist noch nicht konfiguriert.");
  }

  googleMapsScriptPromise = new Promise<GoogleMapsApi>((resolve, reject) => {
    const finish = () => {
      const maps = (window as GoogleMapsWindow).google?.maps;
      if (maps?.Geocoder) {
        resolve(maps);
      } else {
        googleMapsScriptPromise = null;
        reject(new Error("Google Maps konnte nicht geladen werden."));
      }
    };

    const existing = document.getElementById(
      "bb-google-maps-geocoder",
    ) as HTMLScriptElement | null;

    if (existing) {
      const maps = (window as GoogleMapsWindow).google?.maps;
      if (maps?.Geocoder) {
        resolve(maps);
        return;
      }
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => {
          googleMapsScriptPromise = null;
          reject(new Error("Google Maps konnte nicht geladen werden."));
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = "bb-google-maps-geocoder";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => {
        googleMapsScriptPromise = null;
        reject(new Error("Google Maps konnte nicht geladen werden."));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return googleMapsScriptPromise;
}

async function reverseGeocodePosition(
  lat: number,
  lng: number,
): Promise<ReverseGeocodedAddress> {
  const maps = await loadGoogleMapsForGeocoding();
  const geocoder = new maps.Geocoder();

  const results = await new Promise<GoogleGeocoderResult[]>((resolve, reject) => {
    geocoder.geocode({ location: { lat, lng } }, (items, status) => {
      if (status === "OK" && Array.isArray(items) && items.length > 0) {
        resolve(items);
        return;
      }
      reject(new Error("Für diesen Standort konnte keine Adresse gefunden werden."));
    });
  });

  const result =
    results.find((item) => {
      const components = item.address_components || [];
      return Boolean(
        googleComponent(components, "route") &&
          googleComponent(components, "postal_code"),
      );
    }) || results[0];

  const components = result.address_components || [];
  return {
    street: googleComponent(components, "route"),
    house: googleComponent(components, "street_number"),
    zip: cleanZip(googleComponent(components, "postal_code")),
    city: reverseGeocoderCity(components),
    country: googleComponent(components, "country", true),
    formattedAddress: String(result.formatted_address || "").trim(),
    lat,
    lng,
  };
}

function officialStreetFor(streets: string[], value: string) {
  return streets.find((candidate) => streetEquals(candidate, value)) || "";
}

async function validateDeliveryAddress(params: {
  street: string;
  house: string;
  zip: string;
  city: string;
}): Promise<AddressValidationResponse | null> {
  try {
    const response = await fetch("/api/maps/address/validate", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(params),
    });

    const data = (await response.json().catch(() => null)) as
      | AddressValidationResponse
      | null;

    if (!response.ok || !data?.ok) {
      // Checkout da Google geçici olarak yoksa resmi PLZ + sokak listesiyle
      // sipariş akışını canlı tutuyor. Burada aynı fallback uygulanır.
      if (response.status >= 429 || response.status === 403) return null;
      throw new Error(
        data?.message || "Die Lieferadresse konnte gerade nicht geprüft werden.",
      );
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function geolocationErrorMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return error instanceof Error
      ? error.message
      : "Standort konnte nicht ermittelt werden.";
  }

  const code = Number((error as { code?: number }).code);
  if (code === 1) return "Standortfreigabe wurde abgelehnt.";
  if (code === 2) return "Der aktuelle Standort ist nicht verfügbar.";
  if (code === 3) return "Die Standortbestimmung hat zu lange gedauert.";
  return "Standort konnte nicht ermittelt werden.";
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
  const [streetQuery, setStreetQuery] = useState("");
  const [showStreetOptions, setShowStreetOptions] = useState(false);
  const [streetsVersion, setStreetsVersion] = useState(0);
  const [house, setHouse] = useState("");
  const [city, setCity] = useState("Berlin");
  const [busy, setBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationSuggestion, setLocationSuggestion] =
    useState<LocationSuggestion | null>(null);
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

  const streetOptions = useMemo(() => {
    void streetsVersion;
    if (zip.length !== 5 || !isDeliverableZip(zip)) return [];
    return searchStreets(zip, streetQuery, 12);
  }, [isDeliverableZip, streetQuery, streetsVersion, zip]);

  const startForm = useCallback((address?: Address | null) => {
    setView("form");
    setError("");
    setLabel(address?.label || "Zuhause");
    setZip(address?.zip || "");
    setStreet(address?.street || "");
    setStreetQuery(address?.street || "");
    setHouse(address?.house || "");
    setCity(address?.city || "Berlin");
    setLocationSuggestion(null);
    setShowStreetOptions(false);
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
    if (!open || view !== "form") return;
    let active = true;
    void hydrateFromBundledJSON().finally(() => {
      if (active) setStreetsVersion((value) => value + 1);
    });
    return () => {
      active = false;
    };
  }, [open, view]);

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

  const onZipChange = useCallback((value: string) => {
    const next = cleanZip(value);
    setZip(next);
    setStreet("");
    setStreetQuery("");
    setHouse("");
    setCity("Berlin");
    setLocationSuggestion(null);
    setShowStreetOptions(false);
    setError("");
  }, []);

  const onStreetSearchChange = useCallback(
    (value: string) => {
      setStreetQuery(value);
      setLocationSuggestion(null);
      setError("");
      setShowStreetOptions(true);

      const exact = officialStreetFor(getStreets(zip), value);
      setStreet(exact);
    },
    [zip],
  );

  const chooseStreet = useCallback((value: string) => {
    setStreet(value);
    setStreetQuery(value);
    setShowStreetOptions(false);
    setError("");
  }, []);

  const useCurrentDeliveryLocation = useCallback(async () => {
    if (locationBusy) return;
    setError("");
    setLocationSuggestion(null);

    if (!("geolocation" in navigator)) {
      setError("Standortbestimmung wird von diesem Gerät nicht unterstützt.");
      return;
    }

    setLocationBusy(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 5_000,
          timeout: 15_000,
        });
      });

      const accuracyMeters = Number.isFinite(Number(position.coords.accuracy))
        ? Math.max(0, Math.round(Number(position.coords.accuracy)))
        : 999;

      if (accuracyMeters > 100) {
        throw new Error(
          `Standort ist zu ungenau (±${accuracyMeters} m). Bitte genaue Standortfreigabe aktivieren oder die Adresse über PLZ und Straßenliste auswählen.`,
        );
      }

      const found = await reverseGeocodePosition(
        Number(position.coords.latitude),
        Number(position.coords.longitude),
      );

      if (found.country && found.country !== "DE") {
        throw new Error("Der aktuelle Standort liegt nicht in Deutschland.");
      }
      if (!/^\d{5}$/.test(found.zip)) {
        throw new Error("Für den aktuellen Standort konnte keine PLZ erkannt werden.");
      }
      if (!isDeliverableZip(found.zip)) {
        throw new Error(
          `Der aktuelle Standort (${found.zip}) liegt außerhalb unseres Liefergebiets.`,
        );
      }

      await hydrateFromBundledJSON();
      setStreetsVersion((value) => value + 1);
      const list = getStreets(found.zip);
      if (!list.length) {
        throw new Error(
          "Die Straßenliste konnte gerade nicht geladen werden. Bitte kurz erneut versuchen.",
        );
      }

      const officialStreet = officialStreetFor(list, found.street);
      if (!officialStreet) {
        throw new Error(
          "Die erkannte Straße gehört nicht zu unserer offiziellen Straßenliste für diese PLZ.",
        );
      }

      const suggestion: LocationSuggestion = {
        ...found,
        officialStreet,
        accuracyMeters,
      };

      setZip(found.zip);
      setStreet(officialStreet);
      setStreetQuery(officialStreet);
      setHouse(found.house || "");
      setCity(found.city || "Berlin");
      setLocationSuggestion(suggestion);
      setShowStreetOptions(false);

      if (!found.house) {
        setError(
          "Standort erkannt. Die Hausnummer konnte nicht eindeutig erkannt werden – bitte nur die Hausnummer ergänzen.",
        );
      }
    } catch (locationError) {
      setError(geolocationErrorMessage(locationError));
    } finally {
      setLocationBusy(false);
    }
  }, [isDeliverableZip, locationBusy]);

  const saveAndContinue = useCallback(async () => {
    if (busy) return;
    setError("");

    const code = cleanZip(zip);
    const officialStreet = officialStreetFor(getStreets(code), street);
    const houseValue = house.trim();

    if (code.length !== 5 || !isDeliverableZip(code)) {
      setError(
        "Leider liefern wir nicht in diese Postleitzahl. Bitte ändere die Adresse oder wähle Abholung.",
      );
      return;
    }
    if (!officialStreet || !streetEquals(officialStreet, streetQuery)) {
      setError("Bitte eine Straße aus der offiziellen Liste auswählen.");
      return;
    }
    if (!houseValue) {
      setError("Bitte Hausnummer eingeben.");
      return;
    }

    setBusy(true);
    try {
      let streetFinal = officialStreet;
      let houseFinal = houseValue;
      let cityFinal = city || "Berlin";

      const validation = await validateDeliveryAddress({
        street: officialStreet,
        house: houseValue,
        zip: code,
        city: cityFinal,
      });

      if (validation) {
        if (
          !validation.valid ||
          !validation.addressComplete ||
          validation.hasUnconfirmedComponents
        ) {
          setError(
            "Die Adresse konnte nicht eindeutig bestätigt werden. Bitte PLZ, Straße und Hausnummer prüfen.",
          );
          return;
        }

        const validatedZip = cleanZip(validation.zip);
        if (validatedZip !== code || !isDeliverableZip(validatedZip)) {
          setError(
            `Die bestätigte Adresse gehört zur PLZ ${validatedZip || "unbekannt"}. Bitte PLZ prüfen.`,
          );
          return;
        }

        const validatedOfficialStreet = officialStreetFor(
          getStreets(validatedZip),
          String(validation.street || ""),
        );
        if (!validatedOfficialStreet) {
          setError(
            "Die von Google bestätigte Straße gehört nicht zu unserer offiziellen Lieferliste.",
          );
          return;
        }

        streetFinal = validatedOfficialStreet;
        houseFinal = String(validation.house || houseValue).trim();
        cityFinal = String(validation.city || cityFinal).trim() || "Berlin";
      }

      const address: Address = {
        id: `local:${code}:${streetFinal.toLocaleLowerCase("de-DE")}:${houseFinal.toLocaleLowerCase("de-DE")}`,
        label,
        street: streetFinal,
        house: houseFinal,
        zip: code,
        city: cityFinal,
      };

      persistAddress(address);
      setCurrentAddress(address);
      setOpen(false);
      router.push("/checkout");
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Die Lieferadresse konnte nicht geprüft werden.",
      );
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    city,
    house,
    isDeliverableZip,
    label,
    persistAddress,
    router,
    street,
    streetQuery,
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
            className="max-h-[calc(100dvh-24px)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl"
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

                <button
                  type="button"
                  onClick={() => void useCurrentDeliveryLocation()}
                  disabled={locationBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-400/35 bg-sky-500/10 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-wait disabled:opacity-60"
                >
                  <span aria-hidden="true">📍</span>
                  {locationBusy
                    ? "Standort wird ermittelt…"
                    : "Meinen Standort verwenden"}
                </button>

                {locationSuggestion && (
                  <div
                    className={`rounded-xl border p-3 text-xs ${
                      locationSuggestion.accuracyMeters > 40
                        ? "border-amber-400/35 bg-amber-500/10 text-amber-100"
                        : "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                    }`}
                  >
                    <div className="font-bold">Standort erkannt</div>
                    <div className="mt-1 text-zinc-200">
                      {locationSuggestion.officialStreet}
                      {locationSuggestion.house
                        ? ` ${locationSuggestion.house}`
                        : ""}
                      , {locationSuggestion.zip} {locationSuggestion.city}
                    </div>
                    <div className="mt-1 text-zinc-400">
                      Genauigkeit: ±{locationSuggestion.accuracyMeters} m · Bitte kurz prüfen.
                    </div>
                  </div>
                )}

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
                      onChange={(event) => onZipChange(event.target.value)}
                      maxLength={5}
                      placeholder="13507"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 outline-none focus:border-amber-300/50"
                    />
                  </div>

                  <div className="relative">
                    <label
                      className="mb-1 block text-xs text-zinc-400"
                      htmlFor="bb-gate-street"
                    >
                      Straße aus Liste
                    </label>
                    <input
                      id="bb-gate-street"
                      value={streetQuery}
                      disabled={zip.length !== 5 || !isDeliverableZip(zip)}
                      onFocus={() => setShowStreetOptions(true)}
                      onChange={(event) => onStreetSearchChange(event.target.value)}
                      placeholder={
                        zip.length === 5 && isDeliverableZip(zip)
                          ? "Straße suchen…"
                          : "Zuerst gültige PLZ"
                      }
                      autoComplete="off"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={showStreetOptions}
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 outline-none focus:border-amber-300/50 disabled:cursor-not-allowed disabled:opacity-45"
                    />

                    {showStreetOptions &&
                      zip.length === 5 &&
                      isDeliverableZip(zip) &&
                      streetOptions.length > 0 && (
                        <div
                          role="listbox"
                          className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-2xl"
                        >
                          {streetOptions.map((option) => (
                            <button
                              key={option}
                              type="button"
                              role="option"
                              aria-selected={streetEquals(option, street)}
                              onClick={() => chooseStreet(option)}
                              className="block w-full rounded-lg px-3 py-2 text-left text-xs text-zinc-100 hover:bg-white/10"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                </div>

                {zip.length === 5 &&
                  isDeliverableZip(zip) &&
                  streetQuery &&
                  !street && (
                    <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                      Bitte eine passende Straße aus der Liste auswählen. Freie Straßennamen werden nicht übernommen.
                    </div>
                  )}

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
                    autoComplete="address-line2"
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
                  disabled={busy || locationBusy}
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
