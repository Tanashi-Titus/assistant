import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const { api_key, start, end } = req.query;
  if (!api_key) return res.status(400).json({ error: "Missing api_key" });

  const sql = neon(process.env.DATABASE_URL);
  const [user] = await sql`SELECT * FROM users WHERE api_key = ${api_key}`;
  if (!user) return res.status(401).json({ error: "Invalid api_key" });

  const startTs = parseInt(start) || Math.floor(Date.now() / 1000);
  const endTs = parseInt(end) || startTs + 7 * 24 * 3600;

  const [larkToken, googleToken] = await Promise.all([
    user.lark_connected ? getLarkTenantToken(user, sql) : null,
    user.google_connected ? refreshGoogleToken(user, sql) : null,
  ]);

  const [larkEvents, googleEvents] = await Promise.all([
    user.lark_calendar_enabled && larkToken && user.lark_user_id
      ? getLarkEvents(larkToken, user.lark_user_id, startTs, endTs)
      : Promise.resolve([]),
    user.google_calendar_enabled && googleToken
      ? getGoogleEvents(googleToken, startTs, endTs)
      : Promise.resolve([]),
  ]);

  const merged = [...larkEvents, ...googleEvents]
    .sort((a, b) => a.start - b.start);

  return res.json({
    user: user.name,
    lark_connected: user.lark_connected,
    google_connected: user.google_connected,
    total: merged.length,
    events: merged,
  });
}

// ── Lark Tenant Token với cache trong DB ─────────────────
async function getLarkTenantToken(user, sql) {
  // Còn hạn hơn 5 phút thì dùng luôn
  if (
    user.lark_access_token &&
    user.lark_token_expires_at > Date.now() + 5 * 60 * 1000
  ) {
    return user.lark_access_token;
  }

  // Hết hạn → gọi lại API lấy token mới
  try {
    const res = await fetch(
      "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: user.lark_app_id,
          app_secret: user.lark_app_secret,
        }),
      }
    );
    const data = await res.json();
    if (!data.tenant_access_token) return null;

    // Lưu token mới vào DB (expire = now + expire thực tế - 60s buffer)
    await sql`
      UPDATE users SET
        lark_access_token = ${data.tenant_access_token},
        lark_token_expires_at = ${Date.now() + (data.expire - 60) * 1000}
      WHERE id = ${user.id}
    `;
    return data.tenant_access_token;
  } catch { return null; }
}

// ── Google refresh token ─────────────────────────────────
async function refreshGoogleToken(user, sql) {
  if (user.google_token_expires_at > Date.now() + 5 * 60 * 1000) {
    return user.google_access_token;
  }
  if (!user.google_refresh_token) return user.google_access_token;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
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
  } catch { return user.google_access_token; }
}

// ── Helpers ──────────────────────────────────────────────
function toVNTime(dateStr) {
  return new Date(dateStr).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

async function getLarkEvents(tenantToken, larkUserId, start, end) {
  try {
    // Lấy calendar_id của user
    const calRes = await fetch(
      `https://open.larksuite.com/open-apis/calendar/v4/calendars?user_id_type=open_id`,
      {
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "X-Lark-User-Id": larkUserId,
        }
      }
    );
    const calData = await calRes.json();
    const calendarId = calData.data?.calendar_list?.[0]?.calendar_id || "primary";

    const res = await fetch(
      `https://open.larksuite.com/open-apis/calendar/v4/calendars/${calendarId}/events?start_time=${start}&end_time=${end}&user_id_type=open_id`,
      {
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "X-Lark-User-Id": larkUserId,
        }
      }
    );
    const data = await res.json();
    console.log("Lark events response:", JSON.stringify(data).slice(0, 200));

    return (data.data?.items || []).map(e => {
      const startMs = parseInt(e.start_time?.timestamp) * 1000;
      const endMs = parseInt(e.end_time?.timestamp) * 1000;
      return {
        source: "🔵 Lark",
        title: e.summary,
        start: parseInt(e.start_time?.timestamp),
        end: parseInt(e.end_time?.timestamp),
        start_display: toVNTime(new Date(startMs).toISOString()),
        end_display: toVNTime(new Date(endMs).toISOString()),
        description: e.description || "",
      };
    });
  } catch (e) {
    console.error("Lark events error:", e);
    return [];
  }
}

async function getGoogleEvents(token, start, end) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${new Date(start * 1000).toISOString()}&timeMax=${new Date(end * 1000).toISOString()}&singleEvents=true&orderBy=startTime&timeZone=Asia/Ho_Chi_Minh`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    return (data.items || []).map(e => {
      const startDt = e.start.dateTime || e.start.date;
      const endDt = e.end.dateTime || e.end.date;
      return {
        source: "🔴 Google",
        title: e.summary,
        start: Math.floor(new Date(startDt).getTime() / 1000),
        end: Math.floor(new Date(endDt).getTime() / 1000),
        start_display: toVNTime(startDt),
        end_display: toVNTime(endDt),
        description: e.description || "",
      };
    });
  } catch { return []; }
}