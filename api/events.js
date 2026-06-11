import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const { api_key, start, end } = req.query;

  if (!api_key) {
    return res.status(401).json({ error: "Missing api_key" });
  }

  const users = await sql`
    SELECT u.*,
      array_agg(tc.tool_name) FILTER (WHERE tc.enabled = true) AS enabled_tools
    FROM users u
    LEFT JOIN tool_config tc ON tc.user_id = u.id
    WHERE u.api_key = ${api_key}
    GROUP BY u.id
  `;

  if (users.length === 0) {
    return res.status(401).json({ error: "Invalid api_key" });
  }

  const user = users[0];
  const enabledTools = user.enabled_tools || [];

  const now = Math.floor(Date.now() / 1000);
  const startTs = start ? parseInt(start) : now;
  const endTs = end ? parseInt(end) : now + 7 * 24 * 3600;

  const results = await Promise.allSettled([
    enabledTools.includes("lark_calendar")
      ? fetchLarkEvents(user, startTs, endTs)
      : Promise.resolve([]),
    enabledTools.includes("google_calendar")
      ? fetchGoogleEvents(user, startTs, endTs)
      : Promise.resolve([]),
  ]);

  const larkEvents = results[0].status === "fulfilled" ? results[0].value : [];
  const googleEvents = results[1].status === "fulfilled" ? results[1].value : [];

  const allEvents = [...larkEvents, ...googleEvents].sort(
    (a, b) => a.start_time - b.start_time
  );

  return res.status(200).json({
    events: allEvents,
    count: allEvents.length,
    period: { start: startTs, end: endTs },
  });
}

async function fetchLarkEvents(user, startTs, endTs) {
  let accessToken = user.lark_access_token;
  if (Date.now() > user.lark_token_expires_at - 60000) {
    accessToken = await refreshLarkToken(user);
  }
  const res = await fetch(
    `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events?start_time=${startTs}&end_time=${endTs}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (data.code !== 0) return [];
  return (data.data?.items || []).map((e) => ({
    id: e.event_id,
    title: e.summary || "(Không có tiêu đề)",
    start_time: parseInt(e.start_time?.timestamp || 0),
    end_time: parseInt(e.end_time?.timestamp || 0),
    source: "lark",
    location: e.location?.name || null,
  }));
}

async function refreshLarkToken(user) {
  const res = await fetch("https://open.larksuite.com/open-apis/authen/v1/refresh_access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: user.lark_refresh_token,
      app_id: process.env.LARK_APP_ID,
      app_secret: process.env.LARK_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error("Lark refresh failed");
  const { access_token, refresh_token, expires_in } = data.data;
  const expiresAt = Date.now() + expires_in * 1000;
  await sql`
    UPDATE users SET
      lark_access_token = ${access_token},
      lark_refresh_token = ${refresh_token},
      lark_token_expires_at = ${expiresAt}
    WHERE id = ${user.id}
  `;
  return access_token;
}

async function fetchGoogleEvents(user, startTs, endTs) {
  let accessToken = user.google_access_token;
  if (Date.now() > user.google_token_expires_at - 60000) {
    accessToken = await refreshGoogleToken(user);
  }
  const timeMin = new Date(startTs * 1000).toISOString();
  const timeMax = new Date(endTs * 1000).toISOString();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (data.error) return [];
  return (data.items || []).map((e) => ({
    id: e.id,
    title: e.summary || "(Không có tiêu đề)",
    start_time: Math.floor(new Date(e.start?.dateTime || e.start?.date).getTime() / 1000),
    end_time: Math.floor(new Date(e.end?.dateTime || e.end?.date).getTime() / 1000),
    source: "google",
    location: e.location || null,
  }));
}

async function refreshGoogleToken(user) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: user.google_refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error("Google refresh failed");
  const expiresAt = Date.now() + data.expires_in * 1000;
  await sql`
    UPDATE users SET
      google_access_token = ${data.access_token},
      google_token_expires_at = ${expiresAt}
    WHERE id = ${user.id}
  `;
  return data.access_token;
}