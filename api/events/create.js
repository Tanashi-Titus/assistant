import { getUserById, refreshGoogleToken, refreshLarkToken, getDb } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, title, description, start, end, attendees, location, target } = req.body;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });
  if (!title || !start || !end) return res.status(400).json({ error: 'Missing title, start, or end' });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Invalid uid' });

  const sql = getDb();
  const createTarget = target || 'both'; // "google" | "lark" | "both"
  const result = { google: null, lark: null };

  // ── Tạo trên Google Calendar ──
  if ((createTarget === 'google' || createTarget === 'both') && user.google_connected) {
    const token = await refreshGoogleToken(user);
    if (token) {
      const gEvent = {
        summary: title,
        description: description || '',
        location: location || '',
        start: { dateTime: new Date(start * 1000).toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
        end: { dateTime: new Date(end * 1000).toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
      };
      if (attendees && attendees.length > 0) {
        gEvent.attendees = attendees.map(email => ({ email }));
      }

      const gRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(gEvent),
      });
      const gData = await gRes.json();
      if (gData.id) {
        result.google = { event_id: gData.id, link: gData.htmlLink };
      }
    }
  }

  // ── Tạo trên Lark Calendar ──
  if ((createTarget === 'lark' || createTarget === 'both') && user.lark_connected) {
    const token = await refreshLarkToken(user);
    if (token) {
      const lEvent = {
        summary: title,
        description: description || '',
        start_time: { timestamp: String(start) },
        end_time: { timestamp: String(end) },
      };

      const lRes = await fetch('https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(lEvent),
      });
      const lData = await lRes.json();
      const larkEventId = lData.data?.event?.event_id;
      if (larkEventId) {
        result.lark = { event_id: larkEventId };

        // Thêm attendees cho Lark
        if (attendees && attendees.length > 0) {
          try {
            await fetch(
              `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${larkEventId}/attendees`,
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  attendees: attendees.map(email => ({ type: 'third_party', third_party_email: email })),
                }),
              }
            );
          } catch (e) {
            console.error('Lark add attendees error:', e.message);
          }
        }
      }
    }
  }

  // ── Lưu event_map nếu tạo cả 2 bên ──
  if (result.google?.event_id && result.lark?.event_id) {
    await sql`
      INSERT INTO event_map (user_id, google_event_id, lark_event_id, synced_at)
      VALUES (${user.id}, ${result.google.event_id}, ${result.lark.event_id}, ${Date.now()})
      ON CONFLICT DO NOTHING
    `;
  }

  return res.json({
    message: 'Event created',
    google_event: result.google,
    lark_event: result.lark,
  });
}
