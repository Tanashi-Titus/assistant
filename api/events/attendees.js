import { getUserByApiKey, refreshGoogleToken, refreshLarkToken } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { api_key, event_id, source, action, attendees } = req.body;
  if (!api_key) return res.status(400).json({ error: 'Missing api_key' });
  if (!event_id || !source || !action || !attendees?.length) {
    return res.status(400).json({ error: 'Missing event_id, source, action, or attendees' });
  }

  const user = await getUserByApiKey(api_key);
  if (!user) return res.status(401).json({ error: 'Invalid api_key' });

  // ── Google Calendar Attendees ──
  if (source === 'google' && user.google_connected) {
    const token = await refreshGoogleToken(user);

    // Lấy event hiện tại
    const getRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event_id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const event = await getRes.json();
    if (!event.id) return res.status(404).json({ error: 'Event not found on Google' });

    let currentAttendees = event.attendees || [];

    if (action === 'add') {
      const newEmails = attendees.filter(e => !currentAttendees.some(a => a.email === e));
      currentAttendees = [...currentAttendees, ...newEmails.map(email => ({ email }))];
    } else if (action === 'remove') {
      currentAttendees = currentAttendees.filter(a => !attendees.includes(a.email));
    }

    const patchRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event_id}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: currentAttendees }),
      }
    );

    return res.json({
      message: `Attendees ${action === 'add' ? 'added' : 'removed'}`,
      source: 'google',
      status: patchRes.ok ? 'ok' : 'failed',
      attendees: currentAttendees.map(a => a.email),
    });
  }

  // ── Lark Calendar Attendees ──
  if (source === 'lark' && user.lark_connected) {
    const token = await refreshLarkToken(user);

    if (action === 'add') {
      const lRes = await fetch(
        `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${event_id}/attendees`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attendees: attendees.map(email => ({ type: 'third_party', third_party_email: email })),
          }),
        }
      );
      const lData = await lRes.json();
      return res.json({
        message: 'Attendees added',
        source: 'lark',
        status: lRes.ok ? 'ok' : 'failed',
        detail: lData,
      });
    }

    if (action === 'remove') {
      // Lark: lấy danh sách attendees trước
      const listRes = await fetch(
        `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${event_id}/attendees`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const listData = await listRes.json();
      const currentAttendees = listData.data?.items || [];

      // Tìm attendee IDs để xóa
      const toRemove = currentAttendees
        .filter(a => attendees.includes(a.third_party_email))
        .map(a => a.attendee_id);

      if (toRemove.length > 0) {
        const delRes = await fetch(
          `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${event_id}/attendees/batch_delete`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ attendee_ids: toRemove }),
          }
        );
        return res.json({
          message: 'Attendees removed',
          source: 'lark',
          status: delRes.ok ? 'ok' : 'failed',
          removed: toRemove.length,
        });
      }

      return res.json({ message: 'No matching attendees found to remove', source: 'lark' });
    }
  }

  return res.status(400).json({ error: 'Invalid source or user not connected' });
}
