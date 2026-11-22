type DriveEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
};

export function driveConfigured(env: DriveEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
}

async function accessToken(env: DriveEnv): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(body.error || 'Không lấy được Google access token.');
  return body.access_token;
}

export async function uploadBackupToDrive(
  env: DriveEnv,
  input: { name: string; bytes: ArrayBuffer; contentType?: string },
): Promise<string> {
  if (!driveConfigured(env)) throw new Error('Chưa cấu hình Google Drive secrets.');
  const token = await accessToken(env);
  const metadata: Record<string, unknown> = {
    name: input.name,
    mimeType: input.contentType || 'application/sql',
  };
  if (env.GOOGLE_DRIVE_FOLDER_ID) metadata.parents = [env.GOOGLE_DRIVE_FOLDER_ID];

  const boundary = `vdt_${crypto.randomUUID().replace(/-/g, '')}`;
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const fileHeader = `--${boundary}\r\nContent-Type: ${input.contentType || 'application/sql'}\r\n\r\n`;
  const footer = `\r\n--${boundary}--`;
  const encoder = new TextEncoder();
  const metaBytes = encoder.encode(metaPart);
  const headerBytes = encoder.encode(fileHeader);
  const footerBytes = encoder.encode(footer);
  const body = new Uint8Array(metaBytes.length + headerBytes.length + input.bytes.byteLength + footerBytes.length);
  body.set(metaBytes, 0);
  body.set(headerBytes, metaBytes.length);
  body.set(new Uint8Array(input.bytes), metaBytes.length + headerBytes.length);
  body.set(footerBytes, metaBytes.length + headerBytes.length + input.bytes.byteLength);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) throw new Error(data.error?.message || `Upload Drive thất bại (${res.status}).`);
  return data.id;
}

export async function deleteDriveFile(env: DriveEnv, fileId: string): Promise<void> {
  if (!driveConfigured(env) || !fileId) return;
  const token = await accessToken(env);
  await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
}
