"use client";

import { useEffect, useState } from "react";

interface Result<T> {
  key: string;
  data?: T;
  error?: boolean;
}

/**
 * GET a JSON endpoint. `status` is "loading" until the response for the current url/attempt arrives;
 * `data` keeps the previous response meanwhile so charts do not flash empty when a setting changes.
 */
export function useJson<T>(url: string, attempt = 0): { data: T | null; status: "loading" | "ready" | "error" } {
  const key = `${url}#${attempt}`;
  const [res, setRes] = useState<Result<T> | null>(null);
  const [last, setLast] = useState<T | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(url, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        setLast(data);
        setRes({ key, data });
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setRes({ key, error: true });
      });
    return () => ctl.abort();
  }, [url, key]);

  const current = res && res.key === key ? res : null;
  return { data: current?.data ?? last, status: !current ? "loading" : current.error ? "error" : "ready" };
}
