import { NextResponse, type NextRequest } from "next/server";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { requirePublisherWorkspace } from "@/lib/publisher/route-guard";

export const runtime = "nodejs";

// Product photos are stored in the public Supabase Storage bucket `produtos`.
// The bucket must exist (public) in the Supabase project before uploads work —
// create it once in Dashboard > Storage (or via the CLI). Objects are keyed by
// workspace (and cliente when provided) so a single project stays organized.
const STORAGE_BUCKET = "produtos";

/** Only accept common web image types for product photos. */
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 8 * 1024 * 1024;

function slugifySegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[api/upload] missing Supabase Storage configuration");
      return NextResponse.json(
        { success: false, error: "Armazenamento de imagens não configurado." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const clienteIdRaw = formData.get("clienteId");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "Arquivo não enviado." },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { success: false, error: "Tipo de imagem não suportado." },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "Imagem excede o limite de 8MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = slugifySegment(file.name) || "foto";
    const clienteSegment =
      typeof clienteIdRaw === "string" && clienteIdRaw.trim()
        ? `${slugifySegment(clienteIdRaw.trim())}/`
        : "";
    const objectPath = `${guard.workspaceId}/${clienteSegment}${Date.now()}-${safeName}`;

    const uploadResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": file.type,
          "x-upsert": "true",
          "cache-control": "3600",
        },
        body: buffer,
      },
    );

    if (!uploadResponse.ok) {
      const detail = await uploadResponse.text().catch(() => "");
      console.error(
        `[api/upload] storage upload failed: ${uploadResponse.status} ${detail}`,
      );
      return NextResponse.json(
        { success: false, error: "Falha ao enviar imagem" },
        { status: 502 },
      );
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
    return NextResponse.json({ success: true, url: publicUrl });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/upload] failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao enviar imagem" },
      { status: 500 },
    );
  }
}
