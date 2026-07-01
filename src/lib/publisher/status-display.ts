import type { PublisherPlatform } from "@prisma/client";

type BadgeTone = "neutral" | "info" | "success" | "danger" | "warning";

/** Maps a Produto/Publicacao status string to a badge tone. */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "publicado":
      return "success";
    case "erro":
      return "danger";
    case "publicando":
      return "info";
    case "pendente":
      return "warning";
    default:
      return "neutral";
  }
}

/** Human label for the two supported marketplaces. */
export function platformLabel(platform: PublisherPlatform): string {
  return platform === "SHOPEE" ? "Shopee" : "Mercado Livre";
}

/** pt-BR date-time formatting shared across publisher screens. */
export function formatDateTimeBR(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
