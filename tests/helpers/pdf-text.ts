import { inflateSync } from "node:zlib";

/** The text drawn in a PDF made by pdf-lib: inflate every stream and decode the hex strings passed to Tj. */
export function pdfText(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      continue; // not a compressed content stream (fonts etc.)
    }
    for (const t of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
  }
  return out;
}
