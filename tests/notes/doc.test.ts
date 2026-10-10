import { describe, expect, it } from "vitest";
import { MAX_NOTE_JSON, parseNoteDoc } from "@/lib/notes/doc";

const ok = (v: unknown) => parseNoteDoc(JSON.stringify(v));

describe("parseNoteDoc", () => {
  it("accepts an editor document, including nested lists and headings", () => {
    const doc = { type: "doc", content: [{ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Net P&L: +A$448.95" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }] };
    const r = ok(doc);
    expect(r).toEqual({ ok: true, doc });
  });
  it("keeps text that looks like a protocol marker (dollar signs, tildes) intact", () => {
    const text = "$L1 $@2 $undefined ~ A$1,000";
    const r = ok({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    expect(r.ok && JSON.stringify(r.doc)).toContain(text);
  });
  it("rejects anything that is not a document", () => {
    expect(parseNoteDoc("not json").ok).toBe(false);
    expect(parseNoteDoc("[1,2]").ok).toBe(false);
    expect(parseNoteDoc("null").ok).toBe(false);
    expect(parseNoteDoc('{"type":"paragraph"}').ok).toBe(false);
    expect(parseNoteDoc({ type: "doc" }).ok).toBe(false); // an object, not text
    expect(parseNoteDoc(undefined).ok).toBe(false);
  });
  it("rejects oversized notes", () => {
    const big = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(MAX_NOTE_JSON) }] }] });
    expect(parseNoteDoc(big)).toEqual({ ok: false, error: "This note is too large to save." });
  });
});
