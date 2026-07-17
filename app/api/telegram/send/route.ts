import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireMutationRole,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  token?: string;
  chatId?: string;
  text?: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function json(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function clean(value: any, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

/**
 * Admin panelindeki Telegram test butonu için kontrollü relay.
 * Endpoint public değildir; imzalı admin session + same-origin kontrolü gerekir.
 * Token/chatId yalnızca bu tek test çağrısında kullanılır ve loglanmaz.
 */
export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  const rateError = enforceRateLimit(req, "telegram:test", 5, 10 * 60_000);
  if (rateError) return rateError;

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const token = clean(body?.token, 256);
    const chatId = clean(body?.chatId, 128);
    const text = clean(body?.text, 4_000);
    const parseMode = ["HTML", "Markdown", "MarkdownV2"].includes(
      String(body?.parseMode || ""),
    )
      ? body.parseMode
      : undefined;

    if (!token || !chatId || !text) {
      return json(
        { ok: false, error: "Fehlende Felder (token/chatId/text)." },
        400,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            ...(parseMode ? { parse_mode: parseMode } : {}),
            disable_web_page_preview: true,
          }),
          signal: controller.signal,
          cache: "no-store",
        },
      );

      const data = await telegramResponse.json().catch(() => ({} as any));

      if (!telegramResponse.ok || data?.ok !== true) {
        return json(
          {
            ok: false,
            error: data?.description || `Telegram HTTP ${telegramResponse.status}`,
          },
          502,
        );
      }

      return json({
        ok: true,
        result: data?.result?.message_id || null,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: any) {
    const aborted = error?.name === "AbortError";

    return json(
      {
        ok: false,
        error: aborted ? "Telegram timeout" : error?.message || "Unbekannter Fehler",
      },
      aborted ? 504 : 500,
    );
  }
}
