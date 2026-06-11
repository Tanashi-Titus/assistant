import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const { api_key, start, end } = req.query;

  if (!api_key) return res.status(400).json({ error: "Missing api_key" });

  const sql = neon(process.env.DATABASE_URL);

  const [user] = await sql`
    SELECT * FROM users WHERE api_key = ${api_key}
  `;

  if (!user) return res.status(401).json({ error: "Invalid api_key" });

  const startTs = parseInt(start) || Math.floor(Date.now() / 1000);
  const endTs = parseInt(end) || startTs + 7 * 24 * 3600;

  const [larkEvents, googleEvents] = await Promise.all([
    user.lark_calendar_enabled && user.lark_connected
      ? getLarkEvents(user.lark_access_token, startTs, endTs)
      : Promise.resolve([]),
    user.google_calendar_enabled && user.google_connected
      ? getGoogleEvents(user.google_access_token, startTs, endTs)
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

async function getLarkEvents(token, start, end) {
  try {
    const url = `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events?start_time=${start}&end_time=${end}`;
    console.log("Lark URL:", url);
    
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    console.log("Lark response:", JSON.stringify(data));
    
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
    console.error("Lark error:", e);
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
        source: "google",
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