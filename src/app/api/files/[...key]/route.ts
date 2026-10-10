import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readLocal } from "@/lib/storage";

/** Serves locally stored screenshots (development). Behind the login; production uses Vercel Blob URLs. */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = (await ctx.params).key.join("/");
  let file;
  try {
    file = await readLocal(key);
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!file || !file.mime.startsWith("image/")) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: { "content-type": file.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-disposition": "inline" },
  });
}
