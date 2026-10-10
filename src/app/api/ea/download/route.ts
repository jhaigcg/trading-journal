import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/origin";
import { getSession } from "@/lib/session";

/** The LedgerSync Expert Advisor with this app's ingest URL pre-filled. Behind the login (see proxy.ts). */
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const endpoint = `${appOrigin(req.headers, req.url)}/api/ingest/mt4`;

  const source = await readFile(path.join(process.cwd(), "mt4", "LedgerSync.mq4"), "utf8");
  const out = source.replace("https://YOUR-APP.vercel.app/api/ingest/mt4", endpoint);

  return new NextResponse(out, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": 'attachment; filename="LedgerSync.mq4"',
      "cache-control": "no-store",
    },
  });
}
