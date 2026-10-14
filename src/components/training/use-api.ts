"use client";

import { useEffect, useState } from "react";

/** GET a JSON endpoint and keep the server's own error message (such as "no price data for this time"). */
export function useApi<T>(url: string | null, attempt = 0): { data: T | null; error: string | null; loading: boolean } {
  const key = `${url}#${attempt}`;
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!url) return;
    const ctl = new AbortController();
    fetch(url, { signal: ctl.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
        return body as T;
      })
      .then((data) => setState({ key, data, error: null }))
      .catch((e) => {
        if (e?.name !== "AbortError") setState({ key, data: null, error: e instanceof Error ? e.message : "Request failed" });
      });
    return () => ctl.abort();
  }, [url, key]);

  const current = state && state.key === key ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: !!url && !current };
}

/** POST JSON; resolves to the parsed body or an error message. */
export async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    return r.ok ? { ok: true, data: data as T } : { ok: false, error: data?.error ?? `Request failed (${r.status})` };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

/** Unix seconds as "YYYY-MM-DD HH:mm" in the display timezone. */
export const clockText = (t: number, tzOffsetMin: number) => new Date((t + tzOffsetMin * 60) * 1000).toISOString().slice(0, 16).replace("T", " ");
