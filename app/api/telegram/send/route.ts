// app/api/telegram/route.ts
import { NextResponse } from "next/server";

type Body = {
  token?: string;
  chatId?: string;
  text?: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
};

export async function POST(req: Request) {
  try {
    const { token, chatId, text, parseMode }: Body = await req.json();

    if (!token || !chatId || !text) {
      return NextResponse.json(
        { ok: false, error: "Fehlende Felder (token/chatId/text)." },
        { status: 400 }
      );
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode || "HTML",
        disable_web_page_preview: true,
      }),
    });

    const data = await tgRes.json();
    if (!data?.ok) {
      return NextResponse.json(
        { ok: false, error: data?.description || "Telegram-Fehler." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, result: data?.result?.message_id || null });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unbekannter Fehler" },
      { status: 500 }
    );
  }
}
