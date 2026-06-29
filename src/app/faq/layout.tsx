import Link from "next/link";

import { W3Logo } from "@/components/brand/w3-logo";
import { FaqSidebarNav } from "@/components/docs/faq-sidebar-nav";
import { Button } from "@/components/ui/button";
import { docHref, listDocs } from "@/lib/docs/loader";

export const metadata = {
  title: "FAQ & Documentação — W3 Marketplace",
  description:
    "Guia completo de configuração e conexão dos conectores de marketplace (Mercado Livre, Shopee, Shopify, Nuvemshop e mais).",
};

export default async function FaqLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const groups = await listDocs();
  const navGroups = groups.map((group) => ({
    label: group.label,
    items: group.docs.map((doc) => ({
      title: doc.title,
      href: docHref(doc.slug),
    })),
  }));

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)]">
      <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-surface)_92%,transparent)] backdrop-blur">
        <div className="mx-auto flex h-[64px] max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <W3Logo />
            <span className="hidden h-5 w-px bg-[var(--border-subtle)] sm:block" />
            <span className="hidden text-caption text-[var(--text-tertiary)] sm:block">
              Central de ajuda
            </span>
          </div>
          <Button asChild size="sm" variant="secondary">
            <Link href="/login">Acessar o app</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[232px_1fr]">
        <aside className="hidden lg:block">
          <FaqSidebarNav groups={navGroups} />
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
