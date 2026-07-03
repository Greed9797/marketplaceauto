import type { Produto } from "@prisma/client";

import { buildMlAttributes, buildShopeeAttributes } from "./attribute-payload";
import type { RequiredAttribute } from "./category-attributes";

/**
 * Gate pré-publish: valida um Produto ANTES de disparar a API do marketplace,
 * para o publish parar de estourar em HTTP 400. Retorna a lista de problemas
 * acionáveis; a UI só habilita "Publicar" quando `ok`, senão mostra o checklist.
 */
export type PublishProblem = { campo: string; mensagem: string };
export type PublishValidation = { ok: boolean; problemas: PublishProblem[] };

type Platform = "ml" | "shopee";

/**
 * Resultado read-only do "preview de publicação" consumido pela UI (Fase 1.7):
 * diz se a conta está conectada, se a categoria resolveu, os atributos
 * obrigatórios (para o formulário dirigido) e o checklist do gate. NÃO publica.
 */
export type PublishPreview = {
  platform: Platform;
  connected: boolean;
  categoryResolved: boolean;
  alreadyPublished: boolean;
  requiredAttributes: RequiredAttribute[];
  validation: PublishValidation;
};

const ML_CONDICOES = new Set(["new", "used", "not_specified"]);

/** Imagens com URL pública (marketplace rejeita path local "/..."). */
function countPublicImages(produto: Produto): number {
  const urls = new Set(
    [produto.fotoUrl, ...(produto.imagens ?? [])]
      .map((u) => u?.trim() ?? "")
      .filter((u) => u.length > 0 && !u.startsWith("/")),
  );
  return urls.size;
}

export function validarPublicavel(input: {
  produto: Produto;
  platform: Platform;
  required: RequiredAttribute[];
}): PublishValidation {
  const { produto, platform, required } = input;
  const problemas: PublishProblem[] = [];
  const atributos = produto.atributos as Record<string, string> | null;

  const titulo = (
    platform === "ml" ? produto.tituloMl : produto.tituloShopee
  )?.trim();
  if (!titulo && !produto.nomeOriginal?.trim()) {
    problemas.push({
      campo: "titulo",
      mensagem: "Defina um título do anúncio.",
    });
  }

  if (Number(produto.preco) <= 0) {
    problemas.push({
      campo: "preco",
      mensagem: "Preço deve ser maior que zero.",
    });
  }

  if ((produto.quantidade ?? 0) <= 0) {
    problemas.push({
      campo: "estoque",
      mensagem: "Estoque deve ser maior que zero.",
    });
  }

  if (countPublicImages(produto) < 1) {
    problemas.push({
      campo: "imagens",
      mensagem: "Adicione ao menos 1 imagem com URL pública.",
    });
  }

  if (platform === "ml" && !ML_CONDICOES.has(produto.condicao)) {
    problemas.push({
      campo: "condicao",
      mensagem: "Condição inválida (use novo, usado ou não especificado).",
    });
  }

  if (platform === "shopee") {
    if (produto.categoriaShopeeId == null) {
      problemas.push({
        campo: "categoria",
        mensagem: "Escolha a categoria Shopee.",
      });
    }
    if (!produto.pesoGramas || produto.pesoGramas <= 0) {
      problemas.push({
        campo: "peso",
        mensagem: "Informe o peso da embalagem (a Shopee exige).",
      });
    }
    if (!produto.comprimentoCm || !produto.larguraCm || !produto.alturaCm) {
      problemas.push({
        campo: "dimensoes",
        mensagem: "Informe comprimento, largura e altura da embalagem.",
      });
    }
  }

  // Atributos obrigatórios: cobre exatamente o que o payload conseguirá enviar
  // (enum sem match não conta) — usa o mesmo mapper do publish, sem drift.
  const covered = new Set(
    platform === "ml"
      ? buildMlAttributes({ atributos, required }).map((a) => a.id)
      : buildShopeeAttributes({ atributos, required }).map((a) =>
          String(a.attribute_id),
        ),
  );
  for (const attr of required) {
    if (!attr.required) continue;
    const id = platform === "ml" ? attr.id : String(Number(attr.id));
    if (!covered.has(id)) {
      problemas.push({
        campo: `atributo:${attr.id}`,
        mensagem: `Preencha "${attr.name}" (obrigatório na categoria).`,
      });
    }
  }

  return { ok: problemas.length === 0, problemas };
}
