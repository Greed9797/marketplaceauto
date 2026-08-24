-- Qualidade de dados pra publicar: peso e dimensões da embalagem (Shopee exige;
-- ML me2 também em várias categorias). Schema-agnóstico (resolve via ?schema=).
ALTER TABLE "Produto"
  ADD COLUMN IF NOT EXISTS "pesoGramas" INTEGER,
  ADD COLUMN IF NOT EXISTS "larguraCm" INTEGER,
  ADD COLUMN IF NOT EXISTS "alturaCm" INTEGER,
  ADD COLUMN IF NOT EXISTS "comprimentoCm" INTEGER;
