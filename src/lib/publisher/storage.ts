/**
 * Upload de imagem pro bucket público Supabase `produtos` (mesmo bucket do
 * /api/upload). Usado pela geração de imagem por IA para hospedar o resultado.
 * O bucket deve existir (público) no projeto Supabase.
 */
const STORAGE_BUCKET = "produtos";

function slugifySegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function extForMime(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

/** Faz upload de um buffer de imagem e retorna a URL pública. Lança em falha. */
export async function uploadProdutoImage(input: {
  workspaceId: string;
  clienteId?: string | null;
  buffer: Buffer;
  mimeType: string;
  /** Prefixo do nome do arquivo (ex: "ia"). */
  namePrefix?: string;
  now?: number;
}): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Armazenamento de imagens não configurado.");
  }

  const clienteSegment = input.clienteId?.trim()
    ? `${slugifySegment(input.clienteId.trim())}/`
    : "";
  const stamp = input.now ?? Date.now();
  const name = `${input.namePrefix ?? "img"}-${stamp}.${extForMime(input.mimeType)}`;
  const objectPath = `${input.workspaceId}/${clienteSegment}${name}`;

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": input.mimeType,
        "x-upsert": "true",
        "cache-control": "3600",
      },
      body: new Uint8Array(input.buffer),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Falha ao hospedar imagem (${response.status}) ${detail}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
}
