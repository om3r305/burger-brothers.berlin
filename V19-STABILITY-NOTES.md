# Burger Brothers AI V1.9 stability pass

This branch starts from the final kitchen-note/Hinweis implementation and adds a conservative live-test stability pass for Realtime voice ordering.

## Voice turn defaults

- `OPENAI_REALTIME_VAD_THRESHOLD`: default `0.72`, bounded `0.55..0.90`
- `OPENAI_REALTIME_VAD_PREFIX_MS`: default `320`, bounded `200..600`
- `OPENAI_REALTIME_VAD_SILENCE_MS`: default `720`, bounded `500..1400`
- automatic response interruption is disabled by default; set `OPENAI_REALTIME_INTERRUPT_RESPONSE=1` only to restore immediate server-side interruption

The goal is to stop short background speech/noise from cutting off the assistant and to tolerate natural pauses without adding multi-second latency.

## Ordering behavior

- no spoken waiting filler during normal tool calls
- multi-item requests must stay active until every unambiguous item is handled
- partial success must not be described as full success
- recommendation requests return three live burger options when possible

## Cost controls preserved

- `gpt-realtime-2.1-mini`
- low reasoning effort
- paid transcription remains opt-in
- parallel tool calls remain disabled in this conservative pass

A later guarded-barge-in/batch-tool pass can be added after this live baseline is measured on the real iPhone/restaurant network.
