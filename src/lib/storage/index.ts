import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File storage for screenshots. Local disk in development (./.data/uploads, served through the
 * authenticated /api/files route); Vercel Blob in production when BLOB_READ_WRITE_TOKEN is set.
 * A stored "key" is either a relative path (local) or a full https URL (blob).
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/gif": { ext: "gif", magic: (b) => b.length > 6 && ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1")) },
  "image/webp": { ext: "webp", magic: (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([mime, t]) => [t.ext, mime]));

const root = () => path.resolve(process.cwd(), ".data", "uploads");
const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export type UploadCheck = { ok: true; ext: string } | { ok: false; error: string };

/** Only real images are accepted: the declared type must be allowed AND the bytes must actually look like that format. */
export function checkImage(mime: string, bytes: Buffer): UploadCheck {
  const t = TYPES[mime];
  if (!t) return { ok: false, error: "Only PNG, JPEG, GIF or WebP images can be attached." };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "That image is larger than 8 MB." };
  if (!t.magic(bytes)) return { ok: false, error: "That file is not a valid image." };
  return { ok: true, ext: t.ext };
}

export async function putImage(folder: string, ext: string, bytes: Buffer, mime: string): Promise<string> {
  const name = `${folder}/${randomUUID()}.${ext}`;
  if (blobEnabled()) {
    const { put } = await import("@vercel/blob");
    const res = await put(name, bytes, { access: "public", contentType: mime, addRandomSuffix: true });
    return res.url;
  }
  const file = path.join(root(), name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return name;
}

export async function deleteFile(key: string): Promise<void> {
  if (/^https?:\/\//.test(key)) {
    if (blobEnabled()) {
      const { del } = await import("@vercel/blob");
      await del(key).catch(() => undefined);
    }
    return;
  }
  await rm(safeLocalPath(key), { force: true }).catch(() => undefined);
}

/** Resolve a stored key to a path inside the uploads folder, refusing anything that escapes it. */
export function safeLocalPath(key: string): string {
  const full = path.resolve(root(), key);
  if (full !== root() && !full.startsWith(root() + path.sep)) throw new Error("invalid file key");
  return full;
}

export async function readLocal(key: string): Promise<{ bytes: Buffer; mime: string } | null> {
  try {
    const bytes = await readFile(safeLocalPath(key));
    const ext = path.extname(key).slice(1).toLowerCase();
    return { bytes, mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
