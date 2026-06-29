import { FaqIndexBrowser } from "@/components/docs/faq-index-browser";
import { MarkdownContent } from "@/components/docs/markdown-content";
import {
  docHref,
  getDoc,
  listConnectorDocOptions,
  listDocs,
} from "@/lib/docs/loader";

export default async function FaqIndexPage() {
  const [doc, groups, connectors] = await Promise.all([
    getDoc([]),
    listDocs(),
    listConnectorDocOptions(),
  ]);

  const browserGroups = groups.map((group) => ({
    label: group.label,
    items: group.docs.map((entry) => ({
      title: entry.title,
      href: docHref(entry.slug),
    })),
  }));

  return (
    <section className="space-y-10">
      <header>
        <p className="text-caption text-[var(--text-tertiary)]">
          Central de ajuda
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
          Como podemos ajudar?
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
          Guias de configuração e conexão dos conectores W3ADS. Busque pela
          integração que você quer revisar ou navegue pela documentação.
        </p>
      </header>

      <FaqIndexBrowser connectors={connectors} groups={browserGroups} />

      {doc ? (
        <div className="max-w-[72ch] border-t border-[var(--border-subtle)] pt-8">
          <MarkdownContent source={doc.content} />
        </div>
      ) : null}
    </section>
  );
}
