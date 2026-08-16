import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

type GoogleAddressComponent = {
  componentName?: {
    text?: string;
    languageCode?: string;
  };
  componentType?: string;
  confirmationLevel?: string;
  inferred?: boolean;
  spellCorrected?: boolean;
  replaced?: boolean;
  unexpected?: boolean;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function cleanText(value: unknown, max = 160) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function componentText(components: GoogleAddressComponent[], type: string) {
  const found = components.find((component) => component?.componentType === type);
  return cleanText(found?.componentName?.text || "");
}

function firstComponentText(
  components: GoogleAddressComponent[],
  types: string[],
) {
  for (const type of types) {
    const value = componentText(components, type);
    if (value) return value;
  }
  return "";
}

function addressValidationErrorMessage(status: number) {
  if (status === 400) return "Adresse konnte nicht geprüft werden.";
  if (status === 403) return "Adressprüfung ist nicht freigeschaltet.";
  if (status === 429) return "Adressprüfung ist gerade ausgelastet. Bitte kurz erneut versuchen.";
  return "Adressprüfung ist vorübergehend nicht verfügbar.";
}

export async function POST(req: Request) {
  const rateError = await enforceRateLimit(
    req,
    "maps:address:validate",
    30,
    60_000,
  );
  if (rateError) return rateError;

  const apiKey = String(process.env.GOOGLE_MAPS_SERVER_API_KEY || "").trim();
  if (!apiKey) {
    return json({ ok: false, error: "maps_not_configured" }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const street = cleanText(record.street, 120);
  const house = cleanText(record.house, 40);
  const zip = cleanText(record.zip, 10).replace(/\D/g, "").slice(0, 5);
  const city = cleanText(record.city || "Berlin", 80) || "Berlin";

  if (!street || !house || !/^\d{5}$/.test(zip)) {
    return json({ ok: false, error: "invalid_address_input" }, 400);
  }

  try {
    const response = await fetch(
      `https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          address: {
            regionCode: "DE",
            locality: city,
            postalCode: zip,
            addressLines: [`${street} ${house}`],
          },
        }),
      },
    );

    const raw: unknown = await response.json().catch(() => null);
    const root =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, any>)
        : {};

    if (!response.ok) {
      return json(
        {
          ok: false,
          error: "google_address_validation_failed",
          message: addressValidationErrorMessage(response.status),
        },
        response.status >= 500 ? 502 : response.status,
      );
    }

    const result = root.result && typeof root.result === "object" ? root.result : {};
    const verdict = result.verdict && typeof result.verdict === "object" ? result.verdict : {};
    const address = result.address && typeof result.address === "object" ? result.address : {};
    const geocode = result.geocode && typeof result.geocode === "object" ? result.geocode : {};
    const location = geocode.location && typeof geocode.location === "object" ? geocode.location : {};
    const components: GoogleAddressComponent[] = Array.isArray(address.addressComponents)
      ? address.addressComponents
      : [];

    const validatedStreet = firstComponentText(components, ["route"]);
    const validatedHouse = firstComponentText(components, ["street_number"]);
    const validatedZip = firstComponentText(components, ["postal_code"])
      .replace(/\D/g, "")
      .slice(0, 5);
    const validatedCity = firstComponentText(components, [
      "locality",
      "postal_town",
      "administrative_area_level_3",
    ]);

    const lat = Number(location.latitude);
    const lng = Number(location.longitude);
    const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
    const addressComplete = verdict.addressComplete === true;
    const hasUnconfirmedComponents = verdict.hasUnconfirmedComponents === true;

    const valid = Boolean(
      addressComplete &&
        !hasUnconfirmedComponents &&
        validatedStreet &&
        validatedHouse &&
        /^\d{5}$/.test(validatedZip) &&
        hasLocation,
    );

    return json({
      ok: true,
      valid,
      addressComplete,
      hasUnconfirmedComponents,
      hasInferredComponents: verdict.hasInferredComponents === true,
      hasReplacedComponents: verdict.hasReplacedComponents === true,
      validationGranularity: cleanText(verdict.validationGranularity || "", 80),
      street: validatedStreet,
      house: validatedHouse,
      zip: validatedZip,
      city: validatedCity || city,
      formattedAddress: cleanText(address.formattedAddress || "", 240),
      lat: hasLocation ? lat : null,
      lng: hasLocation ? lng : null,
    });
  } catch (error) {
    console.error("[maps/address/validate]", error);
    return json(
      {
        ok: false,
        error: "address_validation_unavailable",
        message: "Adressprüfung ist vorübergehend nicht verfügbar.",
      },
      502,
    );
  }
}
