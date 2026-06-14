import { getUserById, refreshGoogleToken, getLarkTenantToken, toVNTime } from '../lib/db.js';

export default async function handler(req, res) {
  const { uid, start, end } = req.query;
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: "Invalid uid" });

  const startTs = parseInt(start) || Math.floor(Date.now() / 1000);
  const endTs = parseInt(end) || startTs + 7 * 24 * 3600;

  const [larkToken, googleToken] = await Promise.all([
    user.lark_connected ? getLarkTenantToken(user) : null,
    user.google_connected ? refreshGoogleToken(user) : null,
  ]);

  const [larkEvents, googleEvents] = await Promise.all([
    user.lark_calendar_enabled && larkToken
      ? getLarkEvents(larkToken, startTs, endTs)
      : Promise.resolve([]),
    user.google_calendar_enabled && googleToken
      ? getGoogleEvents(googleToken, startTs, endTs)
      : Promise.resolve([]),
  ]);

  const seen = new Set();
  const merged = [...larkEvents, ...googleEvents]
    .filter(e => {
      if (e.error) return true;
      const key = `${e.title?.trim()}_${e.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start);

  return res.json({
    user: user.name,
    lark_connected: user.lark_connected,
    google_connected: user.google_connected,
    total: merged.length,
    events: merged,
  });
}

// ── Lark Events ──────────────────────────────────────────────

async function getLarkEvents(token, start, end) {
  try {
    const res = await fetch(
      `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events?start_time=${start}&end_time=${end}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    
    if (!res.ok || data.code !== 0) {
      console.error("Lark API Error:", data);
      return [{ source: "🔵 Lark", error: "Lỗi kết nối (Cần đăng nhập lại)", detail: data.msg || "Unauthorized" }];
    }

    return (data.data?.items || []).map(e => {
      const startMs = parseInt(e.start_time?.timestamp) * 1000;
      const endMs = parseInt(e.end_time?.timestamp) * 1000;
      return {
        source: "🔵 Lark",
        event_id: e.event_id,
        title: e.summary,
        start: parseInt(e.start_time?.timestamp),
        end: parseInt(e.end_time?.timestamp),
        start_display: toVNTime(new Date(startMs).toISOString()),
        end_display: toVNTime(new Date(endMs).toISOString()),
        description: e.description || "",
        attendees: (e.attendees || []).map(a => a.display_name || a.third_party_email || '').filter(Boolean),
      };
    });
  } catch (e) {
    console.error("Lark events error:", e);
    return [{ source: "🔵 Lark", error: "Lỗi hệ thống", detail: e.message }];
  }
}

// ── Google Events ────────────────────────────────────────────

async function getGoogleEvents(token, start, end) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${new Date(start * 1000).toISOString()}&timeMax=${new Date(end * 1000).toISOString()}&singleEvents=true&orderBy=startTime&timeZone=Asia/Ho_Chi_Minh`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    
    if (!res.ok) {
      console.error("Google API Error:", data);
      return [{ source: "🔴 Google", error: "Lỗi kết nối (Cần đăng nhập lại)", detail: data.error?.message || "Unauthorized" }];
    }
    
    return (data.items || []).map(e => {
      const startDt = e.start.dateTime || e.start.date;
      const endDt = e.end.dateTime || e.end.date;
      return {
        source: "🔴 Google",
        event_id: e.id,
        title: e.summary,
        start: Math.floor(new Date(startDt).getTime() / 1000),
        end: Math.floor(new Date(endDt).getTime() / 1000),
        start_display: toVNTime(startDt),
        end_display: toVNTime(endDt),
        description: e.description || "",
        attendees: (e.attendees || []).map(a => a.email).filter(Boolean),
        link: e.htmlLink || "",
      };
    });
  } catch (e) { 
    console.error("Google events error:", e);
    return [{ source: "🔴 Google", error: "Lỗi hệ thống", detail: e.message }]; 
  }
}