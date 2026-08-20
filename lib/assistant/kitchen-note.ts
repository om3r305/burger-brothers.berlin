export const MAX_KITCHEN_NOTE_LENGTH = 200;

export function sanitizeKitchenNote(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_KITCHEN_NOTE_LENGTH);
}

/** Omission preserves; an explicit empty or non-empty string clears or replaces. */
export function resolveKitchenNote(currentNote: unknown, requestedNote: unknown): string | undefined {
  if (requestedNote === undefined) return sanitizeKitchenNote(currentNote) || undefined;
  return sanitizeKitchenNote(requestedNote) || undefined;
}
