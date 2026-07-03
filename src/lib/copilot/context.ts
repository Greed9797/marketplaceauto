import { prisma } from "@/lib/db/prisma";
import { previewPublishMl } from "@/lib/publisher/ml-publish";
import { previewPublishShopee } from "@/lib/publisher/shopee-publish";

import type { MiniMaxContentPart, MiniMaxMessage } from "./minimax";

const SYSTEM_BASE = `Você é o copiloto do W3 Marketplace, especialista em anúncios de Mercado Livre e Shopee no Brasil.
Ajuda o vendedor a melhorar e publicar anúncios. Fale pt-BR, direto e prático.

Regras:
- Quando o usuário pedir uma mudança concreta (melhorar título, preencher o que falta, ajustar preço, adicionar atributos, publicar), CHAME a ferramenta apropriada com os valores prontos. NÃO peça confirmação no texto — o app mostra sua proposta e o usuário aprova antes de aplicar.
- Para "adicione o que falta pra publicar na Shopee/ML": use o preview de pendências abaixo e preencha TODOS os campos faltantes numa única chamada de atualizar_produto.
- Títulos: ML máx 60 caracteres, Shopee máx 120. Use palavras-chave que convertem.
- Só chame 'publicar' quando não houver pendências para a plataforma.
- Se não houver produto em contexto, oriente o usuário a abrir um produto na tela de otimização.`;

/**
 * Monta as mensagens de sistema do copiloto: instruções + estado do produto em
 * foco + pendências de publicação (para o M3 saber o que falta e propor o
 * conserto certo). Inclui as imagens do produto (M3 é multimodal).
 */
export async function buildCopilotSystem(input: {
  workspaceId: string;
  produtoId?: string | null;
}): Promise<MiniMaxMessage[]> {
  if (!input.produtoId) {
    return [{ role: "system", content: SYSTEM_BASE }];
  }

  const produto = await prisma.produto.findFirst({
    where: {
      id: input.produtoId,
      cliente: { workspaceId: input.workspaceId },
    },
  });
  if (!produto) return [{ role: "system", content: SYSTEM_BASE }];

  const [ml, shopee] = await Promise.all([
    previewPublishMl({ clienteId: produto.clienteId, produto }).catch(
      () => null,
    ),
    previewPublishShopee({ clienteId: produto.clienteId, produto }).catch(
      () => null,
    ),
  ]);

  const pendencias = (label: string, p: typeof ml) =>
    !p
      ? `${label}: indisponível.`
      : !p.connected
        ? `${label}: conta não conectada.`
        : p.alreadyPublished
          ? `${label}: já publicado.`
          : p.validation.ok
            ? `${label}: pronto para publicar.`
            : `${label}: faltam — ${p.validation.problemas
                .map((x) => x.mensagem)
                .join(" ")}`;

  const atributos = produto.atributos as Record<string, string> | null;
  const estado = [
    `PRODUTO EM FOCO (id ${produto.id}):`,
    `- Nome: ${produto.nomeOriginal}`,
    `- Título ML: ${produto.tituloMl ?? "(vazio)"}`,
    `- Título Shopee: ${produto.tituloShopee ?? "(vazio)"}`,
    `- Descrição: ${produto.descricao ? `${produto.descricao.slice(0, 200)}…` : "(vazia)"}`,
    `- Preço: ${Number(produto.preco)} | Estoque: ${produto.quantidade}`,
    `- Categoria ML: ${produto.categoriaMlId ?? "(auto)"} | Categoria Shopee: ${produto.categoriaShopeeId ?? "(vazia)"}`,
    `- Peso: ${produto.pesoGramas ?? "?"}g | Dim: ${produto.comprimentoCm ?? "?"}x${produto.larguraCm ?? "?"}x${produto.alturaCm ?? "?"}cm`,
    `- Ficha: ${atributos && Object.keys(atributos).length ? Object.entries(atributos).map(([k, v]) => `${k}=${v}`).join("; ") : "(vazia)"}`,
    "",
    "PENDÊNCIAS DE PUBLICAÇÃO:",
    pendencias("Mercado Livre", ml),
    pendencias("Shopee", shopee),
  ].join("\n");

  // Imagens do produto como partes multimodais (M3 vê a foto).
  const urls = [produto.fotoUrl, ...produto.imagens]
    .filter((u): u is string => typeof u === "string" && !u.startsWith("/"))
    .slice(0, 3);
  const parts: MiniMaxContentPart[] = [{ type: "text", text: estado }];
  for (const url of urls) {
    parts.push({ type: "image_url", image_url: { url } });
  }

  return [
    { role: "system", content: SYSTEM_BASE },
    { role: "system", content: parts },
  ];
}
