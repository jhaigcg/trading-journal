/** Largest note document accepted (JSON text). Plenty for a long journal entry; stops a runaway paste. */
export const MAX_NOTE_JSON = 1_000_000;

export type ParsedDoc = { ok: true; doc: Record<string, unknown> } | { ok: false; error: string };

/**
 * Notes travel between the editor and the server as JSON text. Next's server-action argument decoder
 * mishandles deeply nested editor documents, and a string is also easy to size-limit and validate here.
 */
export function parseNoteDoc(json: unknown): ParsedDoc {
  if (typeof json !== "string") return { ok: false, error: "Invalid note." };
  if (json.length > MAX_NOTE_JSON) return { ok: false, error: "This note is too large to save." };
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, error: "Invalid note." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value) || (value as { type?: unknown }).type !== "doc") return { ok: false, error: "Invalid note." };
  return { ok: true, doc: value as Record<string, unknown> };
}
