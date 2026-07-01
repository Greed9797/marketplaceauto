# Fusão W3-Marketplace × marketplace-publisher (auto) — Design

## Contexto
`marketplaceauto` (marketplace-publisher.vercel.app) é um PUBLICADOR de anúncios
(clientes → produtos → publicações na Shopee/ML com IA Gemini). Next.js 14 +
Drizzle/**SQLite local** (não persiste em serverless → hoje o prod está 504
MIDDLEWARE_INVOCATION_TIMEOUT). Os apps OAuth Shopee/ML já estão registrados com
redirect apontando pra `https://marketplace-publisher.vercel.app/api/auth/{shopee,ml}/callback`.

Objetivo do usuário: trazer o publicador PRA DENTRO do nosso W3-Marketplace
(Next.js 15 + Prisma/Supabase + NextAuth + nosso design), reusar o OAuth do auto
(sem criar app novo) e deployar no repo/Vercel do auto (mesmo domínio → redirect
funciona). Nosso Supabase persiste os tokens que o SQLite perdia.

## Arquitetura
- Base = nosso app. Deploy = push pro repo `Greed9797/marketplaceauto` → Vercel do
  auto builda no mesmo domínio.
- Reuso OAuth: expor os paths do auto (`/api/auth/shopee/callback`,
  `/api/auth/ml/callback`), reusar credenciais dos apps via env (SHOPEE_PARTNER_ID/KEY,
  ML_APP_ID/SECRET, redirect URIs do auto), reaproveitar nossa lógica de client
  Shopee/ML já existente. Nenhum app novo.
- Dados: migrar tabelas do auto (clientes, produtos, publicacoes, tokens) de
  SQLite/Drizzle → Prisma/Supabase (persistente). `clientes` sob o Workspace.

## Fases
- A — OAuth reuse + modelo Cliente + pipeline de deploy (fundação, de-risca tudo).
- B — Modelo de dados (produtos/publicações) + backend de publicação (item Shopee/ML + IA).
- C — UI reskinada (clientes/produtos/publicações) com nosso design.
- D — Unificar analytics (mesma conexão alimenta o dashboard de pedidos).

## Pendências de deploy (usuário)
- Acesso ao Vercel do projeto `marketplace-publisher` (ou usuário seta env do nosso app lá).
- Valores das credenciais dos apps (ou já no Vercel do auto).
- Habilitar categoria Order (Shopee) + escopo read (ML) nos apps existentes p/ a
  mesma conexão servir publicar E ler pedidos (Fase D).
