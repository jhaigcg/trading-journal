"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

export interface SyncUiState {
  running: boolean;
  /** 0..1 across all accounts being synced */
  progress: number;
  message: string | null;
  error: string | null;
  done: boolean;
}

const IDLE: SyncUiState = { running: false, progress: 0, message: null, error: null, done: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface StepResult {
  status: "done" | "progress" | "connecting" | "error";
  message?: string;
  progress: number;
}

/** Calls /api/sync repeatedly (each call is one resumable server step) until the account is fully synced. */
async function syncOne(accountId: string, onProgress: (p: number, msg: string | null) => void) {
  let connectTries = 0;
  for (;;) {
    const res = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId }) });
    if (!res.ok) throw new Error(res.status === 401 ? "Your session expired — sign in again." : `Sync failed (${res.status})`);
    const r = (await res.json()) as StepResult;
    if (r.status === "done") return;
    if (r.status === "error") throw new Error(r.message ?? "Sync failed");
    if (r.status === "connecting") {
      if (++connectTries > 30) throw new Error("Timed out connecting to your broker. Check the login details and try again.");
      onProgress(0, r.message ?? "Connecting to your broker…");
      await sleep(3000);
      continue;
    }
    onProgress(r.progress, r.message ?? null);
    if (r.message) await sleep(2000); // another sync holds the lock: wait, then check again
  }
}

export function useSync() {
  const router = useRouter();
  const [state, setState] = useState<SyncUiState>(IDLE);
  const busy = useRef(false);

  const start = useCallback(
    async (accountIds: string[]) => {
      if (busy.current || accountIds.length === 0) return;
      busy.current = true;
      setState({ ...IDLE, running: true });
      try {
        for (let i = 0; i < accountIds.length; i++) {
          await syncOne(accountIds[i], (p, message) => setState((s) => ({ ...s, running: true, progress: (i + p) / accountIds.length, message })));
        }
        setState({ ...IDLE, progress: 1, done: true });
      } catch (e) {
        setState({ ...IDLE, error: e instanceof Error ? e.message : "Sync failed" });
      } finally {
        busy.current = false;
        router.refresh();
      }
    },
    [router],
  );

  return { state, start };
}
