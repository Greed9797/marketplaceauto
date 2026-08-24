import { MobileNavProvider } from "@/components/layouts/mobile-nav-context";
import { Sidebar } from "@/components/layouts/sidebar";
import { Topbar } from "@/components/layouts/topbar";
import { AnalyticsProvider } from "@/components/observability/analytics-provider";
import { getCurrentUserContext } from "@/lib/auth/current";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getCurrentUserContext();

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
