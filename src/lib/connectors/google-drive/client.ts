const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export type DriveFolder = { id: string; name: string };

async function driveFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  return response;
}

/**
 * Finds the app-created folder by name at the Drive root (drive.file scope
 * only sees files this app created), creating it when missing. Idempotent —
 * safe to call on every upload.
 */
export async function ensureDriveFolder(input: {
  accessToken: string;
  name: string;
  parentId?: string | null;
}): Promise<DriveFolder> {
  const parentClause = input.parentId
    ? `'${input.parentId}' in parents`
    : "'me' in owners";
  const escapedName = input.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const query = [
    `name = '${escapedName}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    parentClause,
  ].join(" and ");

  const search = await driveFetch(
    input.accessToken,
    `/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1&orderBy=createdTime`,
  );

  if (!search.ok) {
    throw new Error(`google_drive_search_failed: ${search.status}`);
  }

  const found = (await search.json()) as { files?: DriveFolder[] };
  const existing = found.files?.[0];
  if (existing?.id) return existing;

  const created = await driveFetch(input.accessToken, "/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      mimeType: "application/vnd.google-apps.folder",
      ...(input.parentId ? { parents: [input.parentId] } : {}),
    }),
  });

  if (!created.ok) {
    throw new Error(`google_drive_folder_create_failed: ${created.status}`);
  }

  const folder = (await created.json()) as { id?: string; name?: string };
  if (!folder.id) {
    throw new Error("google_drive_folder_create_missing_id");
  }

  return { id: folder.id, name: folder.name ?? input.name };
}

export type DriveUploadResult = {
  fileId: string;
  name: string;
  mimeType: string;
};

/**
 * Multipart upload (metadata + media em um único request). Arquivos ficam
 * privados por padrão no escopo drive.file — o acesso público passa pelo
 * proxy autenticado /api/files/[workspaceId]/[fileId].
 */
export async function uploadDriveImage(input: {
  accessToken: string;
  name: string;
  folderId: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): Promise<DriveUploadResult> {
  const boundary = `adstart-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: input.name,
    parents: [input.folderId],
  });

  const bodyStart =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${input.mimeType}\r\n\r\n`;
  const bodyEnd = `\r\n--${boundary}--`;

  const body = new Uint8Array(
    bodyStart.length + input.bytes.byteLength + bodyEnd.length,
  );
  body.set(new TextEncoder().encode(bodyStart), 0);
  body.set(new Uint8Array(input.bytes), bodyStart.length);
  body.set(new TextEncoder().encode(bodyEnd), bodyStart.length + input.bytes.byteLength);

  const response = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`google_drive_upload_failed: ${detail.slice(0, 200)}`);
  }

  const file = (await response.json()) as {
    id?: string;
    name?: string;
    mimeType?: string;
  };
  if (!file.id) throw new Error("google_drive_upload_missing_file_id");

  return {
    fileId: file.id,
    name: file.name ?? input.name,
    mimeType: file.mimeType ?? input.mimeType,
  };
}

export async function getDriveFileMeta(input: {
  accessToken: string;
  fileId: string;
}): Promise<{ name: string; mimeType: string } | null> {
  const response = await driveFetch(
    input.accessToken,
    `/files/${encodeURIComponent(input.fileId)}?fields=name,mimeType`,
  );

  // 404 = arquivo apagado ou fora do escopo do app.
  if (!response.ok) return null;

  const file = (await response.json()) as { name?: string; mimeType?: string };
  if (!file.name || !file.mimeType) return null;

  return { name: file.name, mimeType: file.mimeType };
}

export async function downloadDriveFile(input: {
  accessToken: string;
  fileId: string;
}): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const meta = await getDriveFileMeta(input);
  if (!meta) return null;

  const response = await driveFetch(
    input.accessToken,
    `/files/${encodeURIComponent(input.fileId)}?alt=media`,
  );

  if (!response.ok) return null;

  return {
    bytes: await response.arrayBuffer(),
    contentType: meta.mimeType,
  };
}
