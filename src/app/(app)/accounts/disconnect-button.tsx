"use client";

import { disconnectAccount } from "./actions";

export function DisconnectButton({ accountId }: { accountId: string }) {
  return (
    <form
      action={disconnectAccount}
      onSubmit={(e) => {
        if (!confirm("Stop syncing this account? Your imported trades and notes stay in the journal.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="accountId" value={accountId} />
      <button className="inline-flex min-h-9 items-center rounded-control px-3 text-xs text-muted hover:bg-nav-active hover:text-loss">Disconnect</button>
    </form>
  );
}
