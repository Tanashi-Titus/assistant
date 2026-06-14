import { neon } from '@neondatabase/serverless';

let _sql;
export function getDb() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

// ── User lookup ──────────────────────────────────────────────

export async function getUserByApiKey(apiKey) {
  const sql = getDb();
  const [user] = await sql`SELECT * FROM users WHERE api_key = ${apiKey}`;
  return user || null;
}

export async function getUserById(id) {
  const sql = getDb();
  const [user] = await sql`SELECT * FROM users WHERE id = ${id}`;
  return user || null;
}

// ── Google Token Auto-Refresh ────────────────────────────────

export async function refreshGoogleToken(user) {
  const sql = getDb();
  // Còn hạn hơn 5 phút → dùng luôn
  if (user.google_access_token && user.google_token_expires_at > Date.now() + 5 * 60_000) {
    return user.google_access_token;
  }
  if (!user.google_refresh_token) return user.google_access_token;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: user.google_client_id,
        client_secret: user.google_client_secret,
        refresh_token: user.google_refresh_token,
      }),
    });
    const data = await res.json();
    if (!data.access_token) return user.google_access_token;

    await sql`
      UPDATE users SET
        google_access_token = ${data.access_token},
        google_token_expires_at = ${Date.now() + data.expires_in * 1000}
      WHERE id = ${user.id}
    `;
    return data.access_token;
  } catch {
    return user.google_access_token;
  }
}

// ── Lark User Token Auto-Refresh ─────────────────────────────

export async function refreshLarkToken(user) {
  const sql = getDb();
  if (user.lark_access_token && user.lark_token_expires_at > Date.now() + 5 * 60_000) {
    return user.lark_access_token;
  }
  if (!user.lark_refresh_token) return user.lark_access_token;

  try {
    const res = await fetch('https://open.larksuite.com/open-apis/authen/v1/refresh_access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: user.lark_refresh_token,
        app_id: user.lark_app_id,
        app_secret: user.lark_app_secret,
      }),
    });
    const { data } = await res.json();
    if (!data?.access_token) return user.lark_access_token;

    await sql`
      UPDATE users SET
        lark_access_token = ${data.access_token},
        lark_refresh_token = ${data.refresh_token},
        lark_token_expires_at = ${Date.now() + data.expires_in * 1000}
      WHERE id = ${user.id}
    `;
    return data.access_token;
  } catch {
    return user.lark_access_token;
  }
}

// ── Lark Tenant Token (cho bot-level API calls) ──────────────

export async function getLarkTenantToken(user) {
  const sql = getDb();
  // Check cache (dùng field riêng hoặc dùng chung lark_access_token)
  if (user.lark_access_token && user.lark_token_expires_at > Date.now() + 5 * 60_000) {
    return user.lark_access_token;
  }

  try {
    const res = await fetch(
      'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: user.lark_app_id,
          app_secret: user.lark_app_secret,
        }),
      }
    );
    const data = await res.json();
    if (!data.tenant_access_token) return null;

    await sql`
      UPDATE users SET
        lark_access_token = ${data.tenant_access_token},
        lark_token_expires_at = ${Date.now() + (data.expire - 60) * 1000}
      WHERE id = ${user.id}
    `;
    return data.tenant_access_token;
  } catch {
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────

export function toVNTime(dateStr) {
  return new Date(dateStr).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function authGuard(req, res) {
  const apiKey = req.query?.api_key || req.body?.api_key;
  if (!apiKey) {
    res.status(400).json({ error: 'Missing api_key' });
    return null;
  }
  return apiKey;
}
