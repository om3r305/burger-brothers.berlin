const REALTIME_MODELS = new Set([
  "gpt-realtime-2.1",
  "gpt-realtime-2.1-mini",
]);

const SEMANTIC_EAGERNESS = new Set(["low", "medium", "high", "auto"]);

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function clampFloat(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * V2 deliberately uses new env names for model/VAD selection so an old V1.9
 * Vercel override cannot silently put production back on the mini model or
 * re-enable aggressive interruption behavior.
 */
export function buildRealtimeV2Config(env = process.env) {
  const requestedModel = String(env.OPENAI_REALTIME_V2_MODEL || "").trim();
  const model = REALTIME_MODELS.has(requestedModel)
    ? requestedModel
    : "gpt-realtime-2.1";

  // Realtime output budget includes audio/tool output. 220 was small enough to
  // truncate otherwise healthy spoken replies. The limit is only a ceiling;
  // concise replies still pay only for tokens actually produced.
  const maxOutputTokens = clampInt(
    env.OPENAI_REALTIME_V2_MAX_OUTPUT_TOKENS,
    1200,
    400,
    4096,
  );

  const interruptResponse = env.OPENAI_REALTIME_V2_INTERRUPT_RESPONSE === "1";
  const vadMode = String(env.OPENAI_REALTIME_V2_VAD || "semantic_vad").trim();

  if (vadMode === "server_vad") {
    return {
      model,
      maxOutputTokens,
      turnDetection: {
        type: "server_vad",
        threshold: clampFloat(
          env.OPENAI_REALTIME_V2_VAD_THRESHOLD,
          0.72,
          0.55,
          0.9,
        ),
        prefix_padding_ms: clampInt(
          env.OPENAI_REALTIME_V2_VAD_PREFIX_MS,
          320,
          200,
          600,
        ),
        silence_duration_ms: clampInt(
          env.OPENAI_REALTIME_V2_VAD_SILENCE_MS,
          720,
          500,
          1400,
        ),
        create_response: true,
        interrupt_response: interruptResponse,
      },
    };
  }

  const requestedEagerness = String(
    env.OPENAI_REALTIME_V2_SEMANTIC_EAGERNESS || "low",
  ).trim();
  const eagerness = SEMANTIC_EAGERNESS.has(requestedEagerness)
    ? requestedEagerness
    : "low";

  return {
    model,
    maxOutputTokens,
    turnDetection: {
      type: "semantic_vad",
      eagerness,
      create_response: true,
      interrupt_response: interruptResponse,
    },
  };
}
