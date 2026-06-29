import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownContent } from "@/components/docs/markdown-content";
import { type DocCategory, getDoc, listDocs } from "@/lib/docs/loader";

type FaqDocPageProps = {
  params: Promise<{ slug: string[] }>;
};

const CATEGORY_LABELS: Record<DocCategory, string> = {
  geral: "Geral",
  oauth: "Conexão OAuth",
  manual: "Configuração manual",
  reference: "Referência",
};

export async function generateStaticParams() {
  const groups = await listDocs();
  return groups.flatMap((group) =>
    group.docs
      .filter((doc) => doc.slug.length > 0)
      .map((doc) => ({ slug: doc.slug })),
  );
}

export default async function FaqDocPage({ params }: FaqDocPageProps) {
  const { slug } = await params;
  const doc = await getDoc(slug);

  if (!doc) {
    notFound();
  }

  const categoryLabel = CATEGORY_LABELS[doc.category] ?? "Documentação";

  return (
    <section>
      <nav
        aria-label="Trilha de navegação"
        className="flex flex-wrap items-center gap-1.5 text-caption text-[var(--text-tertiary)]"
      >
        <Link
          className="transition-colors hover:text-[var(--text-primary)]"
          href="/faq"
        >
          FAQ
        </Link>
        <span aria-hidden>/</span>
        <span className="text-[var(--text-secondary)]">{categoryLabel}</span>
        <span aria-hidden>/</span>
        <span className="text-[var(--text-primary)]">{doc.title}</span>
      </nav>

      <div className="mt-4 max-w-[72ch]">
        <MarkdownContent source={doc.content} />
      </div>

      <div className="mt-12 border-t border-[var(--border-subtle)] pt-5">
        <Link
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--w3-red)] transition-colors hover:underline"
          href="/faq"
        >
          <span aria-hidden>←</span> Voltar para o FAQ
        </Link>
      </div>
    </section>
  );
}
