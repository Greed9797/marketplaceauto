import { W3Logo } from "@/components/brand/w3-logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="w3-app-shell min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <div className="mx-auto grid min-h-screen w-full max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-[1fr_440px]">
        <section className="hidden lg:block">
          <W3Logo />
          <h1 className="mt-10 max-w-xl font-display text-[3rem] font-normal leading-[0.98] tracking-[-0.03em]">
            Dados de marketplaces e e-commerce em uma unica operacao.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-[var(--text-secondary)]">
            Acesse o workspace da sua empresa, conecte contas e acompanhe
            performance com permissoes por papel desde o primeiro login.
          </p>
        </section>
        {children}
      </div>
    </main>
  );
}
