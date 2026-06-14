import { getUserById, refreshGoogleToken, refreshLarkToken, getDb } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, event_id, source, title, description, start, end, location, sync_to_other } = req.body;
  if (!uid || !event_id || !source) return res.status(400).json({ error: 'Missing required fields' });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Invalid uid' });

  const sql = getDb();
  const result = { updated: null, synced: null };

  // ── Update trên Google ──
  if (source === 'google' && user.google_connected) {
    const token = await refreshGoogleToken(user);
    const patch = {};
    if (title) patch.summary = title;
    if (description !== undefined) patch.description = description;
    if (location !== undefined) patch.location = location;
    if (start) patch.start = { dateTime: new Date(start * 1000).toISOString(), timeZone: 'Asia/Ho_Chi_Minh' };
    if (end) patch.end = { dateTime: new Date(end * 1000).toISOString(), timeZone: 'Asia/Ho_Chi_Minh' };

    const gRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event_id}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }
    );
    result.updated = { source: 'google', status: gRes.ok ? 'ok' : 'failed' };

    // Sync sang Lark nếu có mapping
    if (sync_to_other && user.lark_connected) {
      const [mapping] = await sql`
        SELECT lark_event_id FROM event_map WHERE user_id = ${user.id} AND google_event_id = ${event_id}
      `;
      if (mapping) {
        const larkToken = await refreshLarkToken(user);
        const lPatch = {};
        if (title) lPatch.summary = title;
        if (description !== undefined) lPatch.description = description;
        if (start) lPatch.start_time = { timestamp: String(start) };
        if (end) lPatch.end_time = { timestamp: String(end) };

        await fetch(
          `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${mapping.lark_event_id}`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${larkToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(lPatch),
          }
        );
        result.synced = { source: 'lark', event_id: mapping.lark_event_id };
      }
    }
  }

  // ── Update trên Lark ──
  if (source === 'lark' && user.lark_connected) {
    const token = await refreshLarkToken(user);
    const patch = {};
    if (title) patch.summary = title;
    if (description !== undefined) patch.description = description;
    if (start) patch.start_time = { timestamp: String(start) };
    if (end) patch.end_time = { timestamp: String(end) };

    const lRes = await fetch(
      `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${event_id}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }
    );
    result.updated = { source: 'lark', status: lRes.ok ? 'ok' : 'failed' };

    // Sync sang Google nếu có mapping
    if (sync_to_other && user.google_connected) {
      const [mapping] = await sql`
        SELECT google_event_id FROM event_map WHERE user_id = ${user.id} AND lark_event_id = ${event_id}
      `;
      if (mapping) {
        const googleToken = await refreshGoogleToken(user);
        const gPatch = {};
        if (title) gPatch.summary = title;
        if (description !== undefined) gPatch.description = description;
        if (start) gPatch.start = { dateTime: new Date(start * 1000).toISOString(), timeZone: 'Asia/Ho_Chi_Minh' };
        if (end) gPatch.end = { dateTime: new Date(end * 1000).toISOString(), timeZone: 'Asia/Ho_Chi_Minh' };

        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${mapping.google_event_id}`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(gPatch),
          }
        );
        result.synced = { source: 'google', event_id: mapping.google_event_id };
      }
    }
  }

  return res.json({ message: 'Event updated', ...result });
}
