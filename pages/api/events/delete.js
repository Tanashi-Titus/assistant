import { getUserById, refreshGoogleToken, refreshLarkToken, getDb } from '../../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { uid, event_id, source, delete_synced } = req.body;
  if (!uid || !event_id || !source) return res.status(400).json({ error: 'Missing required fields' });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Invalid uid' });

  const sql = getDb();
  const result = { deleted: null, synced_deleted: null };

  // ── Xóa trên Google ──
  if (source === 'google' && user.google_connected) {
    const token = await refreshGoogleToken(user);
    const gRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event_id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    );
    result.deleted = { source: 'google', status: gRes.ok ? 'ok' : 'failed' };

    // Xóa bên Lark nếu muốn
    if (delete_synced && user.lark_connected) {
      const [mapping] = await sql`
        SELECT lark_event_id FROM event_map WHERE user_id = ${user.id} AND google_event_id = ${event_id}
      `;
      if (mapping) {
        const larkToken = await refreshLarkToken(user);
        await fetch(
          `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${mapping.lark_event_id}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${larkToken}` } }
        );
        result.synced_deleted = { source: 'lark', event_id: mapping.lark_event_id };
      }
    }

    // Xóa mapping
    await sql`DELETE FROM event_map WHERE user_id = ${user.id} AND google_event_id = ${event_id}`;
  }

  // ── Xóa trên Lark ──
  if (source === 'lark' && user.lark_connected) {
    const token = await refreshLarkToken(user);
    const lRes = await fetch(
      `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${event_id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    );
    result.deleted = { source: 'lark', status: lRes.ok ? 'ok' : 'failed' };

    // Xóa bên Google nếu muốn
    if (delete_synced && user.google_connected) {
      const [mapping] = await sql`
        SELECT google_event_id FROM event_map WHERE user_id = ${user.id} AND lark_event_id = ${event_id}
      `;
      if (mapping) {
        const googleToken = await refreshGoogleToken(user);
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${mapping.google_event_id}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${googleToken}` } }
        );
        result.synced_deleted = { source: 'google', event_id: mapping.google_event_id };
      }
    }

    // Xóa mapping
    await sql`DELETE FROM event_map WHERE user_id = ${user.id} AND lark_event_id = ${event_id}`;
  }

  return res.json({ message: 'Event deleted', ...result });
}
