import { after } from "next/server";

import { MobileNavProvider } from "@/components/layouts/mobile-nav-context";
import { Sidebar } from "@/components/layouts/sidebar";
import { Topbar } from "@/components/layouts/topbar";
import { AnalyticsProvider } from "@/components/observability/analytics-provider";
import { getCurrentUserContext } from "@/lib/auth/current";
import { triggerWorkspaceSyncIfStale } from "@/lib/workspace/sync-orchestrator";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getCurrentUserContext();

  // Fire background sync on every page visit. after() sends the response
  // first, then keeps the function alive to complete the sync.
  // The 30-min workspace-level cooldown in triggerWorkspaceSyncIfStale
  // ensures at most one sync per workspace per 30 min regardless of how
  // many users are active simultaneously.
  after(async () => {
    try {
      await triggerWorkspaceSyncIfStale({
        workspaceId: context.currentWorkspace.id,
        triggeredBy: `page:${context.user.id}`,
        includeBackfill: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error(`[layout] sync trigger failed: ${message}`);
    }
  });

  return (
    <main className="w3-app-shell min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <MobileNavProvider>
        {/* Navigation is an off-canvas drawer (opened by the Topbar hamburger);
            page content uses the full screen width — no persistent sidebar. */}
        <Sidebar context={context} />
        <div className="min-h-screen">
          <Topbar context={context} />
          <div className="px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </div>
      </MobileNavProvider>
      <AnalyticsProvider
        userId={context.user.id}
        workspaceId={context.currentWorkspace.id}
      />
    </main>
  );
}
