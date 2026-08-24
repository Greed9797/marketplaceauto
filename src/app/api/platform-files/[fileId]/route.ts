import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { downloadDriveFile } from "@/lib/connectors/google-drive/client";
import {
  getPlatformDriveAccessToken,
} from "@/lib/connectors/google-drive/platform";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";

export const runtime = "nodejs";

/**
 * Proxy de imagens do armazenamento GLOBAL da plataforma. Qualquer usuário
 * autenticado do sistema acessa — os arquivos são do Drive conectado pelo
 * W3_ADMIN como backup/armazenamento de todos os workspaces. O escopo
 * drive.file limita o acesso aos arquivos criados pelo app e os IDs são
 * opacos/unguessable, então só IDs referenciados pelo app são resolvíveis.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;

    // Sessão válida obrigatória (getCurrentUserContext redireciona sem sessão).
    await getCurrentUserContext();

    // Mesma função do upload: renova o access token se estiver perto de
    // expirar em vez de servir 401/500 com token morto. Retorna null quando
    // o Drive global não está conectado.
    const accessToken = await getPlatformDriveAccessToken();
    if (!accessToken) {
      return new NextResponse("Not found", { status: 404 });
    }

    const file = await downloadDriveFile({ accessToken, fileId });
    if (!file) {
      return new NextResponse("Not found", { status: 404 });
    }

    return new NextResponse(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/platform-files] failed: ${message}`);
    return NextResponse.json({ error: "file-fetch-failed" }, { status: 500 });
  }
}
