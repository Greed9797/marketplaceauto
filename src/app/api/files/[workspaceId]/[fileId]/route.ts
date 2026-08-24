import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import {
  downloadDriveFile,
} from "@/lib/connectors/google-drive/client";
import { getActiveDriveAccount } from "@/lib/connectors/google-drive/storage";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import {
  connectorAccessTokenFromAccount,
} from "@/lib/connectors/credentials";

export const runtime = "nodejs";

/**
 * Proxy autenticado para imagens hospedadas no Google Drive do workspace.
 *
 * As URLs persistidas em Produto.fotoUrl/imagens têm o formato
 * /api/files/{workspaceId}/{fileId}. O acesso exige sessão válida E
 * membership no workspace dono do arquivo — as imagens nunca ficam
 * publicamente acessíveis na web.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; fileId: string }> },
) {
  try {
    const { workspaceId, fileId } = await params;

    const context = await getCurrentUserContext();

    const isMember =
      context.currentMembership.workspaceId === workspaceId ||
      context.memberships.some((m) => m.workspaceId === workspaceId);

    // Platform admins (W3_ADMIN/ADMIN_MASTER) operam workspaces via
    // synthetic membership — getCurrentUserContext já resolve isso.
    if (!isMember) {
      return new NextResponse("Not found", { status: 404 });
    }

    const account = await getActiveDriveAccount(workspaceId);
    if (!account) {
      return new NextResponse("Not found", { status: 404 });
    }

    const accessToken = await connectorAccessTokenFromAccount(account);
    const file = await downloadDriveFile({ accessToken, fileId });
    if (!file) {
      return new NextResponse("Not found", { status: 404 });
    }

    return new NextResponse(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        // Imagens de produto mudam raramente; cache privado no browser.
        "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/files] failed: ${message}`);
    return NextResponse.json({ error: "file-fetch-failed" }, { status: 500 });
  }
}
