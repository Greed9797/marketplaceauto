import Link from "next/link";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 text-3xl font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 text-2xl font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 text-lg font-semibold text-[var(--text-primary)]">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mt-3 list-disc space-y-1 pl-6 text-sm text-[var(--text-secondary)]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 list-decimal space-y-1 pl-6 text-sm text-[var(--text-secondary)]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-6">{children}</li>,
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto rounded-md border border-[var(--border-strong)]">
      <table className="w-full min-w-[640px] text-left text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-[var(--bg-elevated)] text-caption text-[var(--text-tertiary)]">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th className="border-b border-[var(--border-strong)] px-3 py-2 font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-[var(--border-subtle)] px-3 py-2 align-top text-[var(--text-secondary)]">
      {children}
    </td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-4 border-[var(--w3-red)] bg-[var(--bg-elevated)] px-4 py-3 text-sm italic text-[var(--text-secondary)]">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <code className="block whitespace-pre-wrap text-xs text-[var(--text-primary)]">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-primary)]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mt-3 overflow-x-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-4 text-xs">
      {children}
    </pre>
  ),
  a: ({ href, children }) => {
    const url = href ?? "#";
    const isInternalDoc = url.endsWith(".md") || url.includes(".md#");

    if (isInternalDoc) {
      const cleaned = url
        .replace(/^(\.\.\/)+/, "")
        .replace(/\.md(#.*)?$/, "$1");
      const normalized = cleaned
        .replace(/^docs\/connectors\//, "")
        .replace(/^README\/?/, "")
        .replace(/\/README$/, "");
      const target = normalized ? `/faq/${normalized}` : "/faq";

      return (
        <Link
          className="text-[var(--w3-red)] underline-offset-2 hover:underline"
          href={target}
        >
          {children}
        </Link>
      );
    }

    return (
      <a
        className="text-[var(--w3-red)] underline-offset-2 hover:underline"
        href={url}
        rel="noopener noreferrer"
        target={url.startsWith("http") ? "_blank" : undefined}
      >
        {children}
      </a>
    );
  },
  hr: () => <hr className="my-6 border-[var(--border-subtle)]" />,
};

export function MarkdownContent({ source }: { source: string }) {
  return (
    <article className="text-sm">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {source}
      </ReactMarkdown>
    </article>
  );
}
