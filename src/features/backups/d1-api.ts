type EnvLike = {
  CF_ACCOUNT_ID?: string;
  D1_DATABASE_ID?: string;
  D1_API_TOKEN?: string;
};

export type D1ExportComplete = {
  filename: string;
  signedUrl: string;
};

/** Bỏ BOM / khoảng trắng ẩn khi dán token từ clipboard. */
function sanitizeToken(raw: string | undefined): string {
  return (raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function config(env: EnvLike) {
  const accountId = env.CF_ACCOUNT_ID?.trim() || '';
  const databaseId = env.D1_DATABASE_ID?.trim() || '';
  const token = sanitizeToken(env.D1_API_TOKEN);
  if (!accountId || !databaseId || !token) {
    throw new Error('Thiếu CF_ACCOUNT_ID, D1_DATABASE_ID hoặc secret D1_API_TOKEN.');
  }
  return { accountId, databaseId, token };
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function explainAuthFailure(token: string, apiMessage: string): Promise<string> {
  try {
    const verify = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await verify.json()) as { success?: boolean; result?: { status?: string } };
    if (!verify.ok || body.result?.status !== 'active') {
      return `${apiMessage} — D1_API_TOKEN không hợp lệ hoặc đã thu hồi (verify ≠ active). Tạo API Token mới: Account → D1 → Edit.`;
    }
  } catch {
    // Bỏ qua lỗi verify; vẫn trả hướng dẫn quyền.
  }
  return `${apiMessage} — D1_API_TOKEN thiếu quyền Account → D1 → Edit (export cần Write/Edit, không dùng D1 Read hay Global API Key).`;
}

function exportUrl(accountId: string, databaseId: string) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/export`;
}

function importUrl(accountId: string, databaseId: string) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/import`;
}

export async function startD1Export(env: EnvLike, tables: string[] | null): Promise<string> {
  const { accountId, databaseId, token } = config(env);
  const dump_options: Record<string, unknown> = { compatibility: 'd1' };
  if (tables && tables.length > 0) dump_options.tables = tables;
  const res = await fetch(exportUrl(accountId, databaseId), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ output_format: 'polling', dump_options }),
  });
  const body = (await res.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { at_bookmark?: string };
  };
  if (!res.ok || !body.result?.at_bookmark) {
    const msg = body.errors?.[0]?.message || `Không bắt đầu export D1 (${res.status}).`;
    if (/authentication|unauthorized|10000/i.test(msg) || res.status === 401 || res.status === 403) {
      throw new Error(await explainAuthFailure(token, msg));
    }
    throw new Error(msg);
  }
  return body.result.at_bookmark;
}

export async function pollD1Export(env: EnvLike, bookmark: string): Promise<D1ExportComplete | null> {
  const { accountId, databaseId, token } = config(env);
  const res = await fetch(exportUrl(accountId, databaseId), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ output_format: 'polling', current_bookmark: bookmark }),
  });
  const body = (await res.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: {
      status?: string;
      error?: string;
      result?: { filename?: string; signed_url?: string };
    };
  };
  if (res.status === 202) return null;
  if (!res.ok) throw new Error(body.errors?.[0]?.message || `Poll export thất bại (${res.status}).`);
  if (body.result?.status === 'error') throw new Error(body.result.error || 'Export D1 lỗi.');
  if (body.result?.status === 'complete' && body.result.result?.signed_url && body.result.result.filename) {
    return { filename: body.result.result.filename, signedUrl: body.result.result.signed_url };
  }
  return null;
}

export async function initD1Import(env: EnvLike, etag: string): Promise<{ uploadUrl: string; filename: string }> {
  const { accountId, databaseId, token } = config(env);
  const res = await fetch(importUrl(accountId, databaseId), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ action: 'init', etag }),
  });
  const body = (await res.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { upload_url?: string; filename?: string };
  };
  if (!res.ok || !body.result?.upload_url || !body.result.filename) {
    throw new Error(body.errors?.[0]?.message || `Init import thất bại (${res.status}).`);
  }
  return { uploadUrl: body.result.upload_url, filename: body.result.filename };
}

export async function ingestD1Import(env: EnvLike, etag: string, filename: string): Promise<string> {
  const { accountId, databaseId, token } = config(env);
  const res = await fetch(importUrl(accountId, databaseId), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ action: 'ingest', etag, filename }),
  });
  const body = (await res.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { at_bookmark?: string };
  };
  if (!res.ok || !body.result?.at_bookmark) {
    throw new Error(body.errors?.[0]?.message || `Ingest import thất bại (${res.status}).`);
  }
  return body.result.at_bookmark;
}

export async function pollD1Import(env: EnvLike, bookmark: string): Promise<'active' | 'complete'> {
  const { accountId, databaseId, token } = config(env);
  const res = await fetch(importUrl(accountId, databaseId), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ action: 'poll', current_bookmark: bookmark }),
  });
  const body = (await res.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { status?: string; error?: string; success?: boolean };
  };
  if (res.status === 202 || body.result?.status === 'active') return 'active';
  if (!res.ok) throw new Error(body.errors?.[0]?.message || `Poll import thất bại (${res.status}).`);
  if (body.result?.status === 'error') throw new Error(body.result.error || 'Import D1 lỗi.');
  // OpenAPI: status complete; tutorial cũ: success=true hoặc hết import.
  if (body.result?.status === 'complete' || body.result?.success === true) return 'complete';
  if (body.result?.error === 'Not currently importing anything.') return 'complete';
  return 'active';
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** MD5 hex cho D1 import etag (Workers có crypto.subtle không có MD5 — dùng WebCrypto polyfill nhẹ). */
export async function md5Hex(bytes: ArrayBuffer): Promise<string> {
  // D1 yêu cầu md5. Trên Workers dùng SubtleCrypto không hỗ trợ MD5 → implement tối thiểu.
  const { md5 } = await import('./md5');
  return md5(new Uint8Array(bytes));
}

export function backupObjectKey(jobId: number, createdAt: number): string {
  const d = new Date(createdAt);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `backups/${y}/${m}/${jobId}.sql`;
}
