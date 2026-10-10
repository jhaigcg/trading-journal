import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { SyncOnLogin } from "@/components/sync/sync-controls";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logout } from "../(auth)/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy already redirects unauthenticated requests; this is the authoritative check.
  if (!(await getSession())) redirect("/login");
  const syncable = await db.account.findMany({
    where: { archived: false, syncType: "AUTO_METAAPI", syncOnLogin: true, metaapiAccountId: { not: null } },
    select: { id: true },
  });
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-bg">
        Skip to content
      </a>
      <Sidebar logout={logout} />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none md:px-7 md:pb-10">
        <SyncOnLogin accountIds={syncable.map((a) => a.id)} />
        {children}
      </main>
    </div>
  );
}
