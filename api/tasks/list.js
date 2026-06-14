import { getUserById, refreshGoogleToken, refreshLarkToken, toVNTime } from '../../lib/db.js';

export default async function handler(req, res) {
  const { uid, status, start, end } = req.query;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Invalid uid' });

  const startTs = parseInt(start) || Math.floor(Date.now() / 1000);
  const endTs = parseInt(end) || startTs + 30 * 24 * 3600; // mặc định 30 ngày tới

  const tasks = [];

  // ── Lấy tasks từ Google Calendar ──
  if (user.google_connected) {
    const token = await refreshGoogleToken(user);
    if (token) {
      try {
        const gRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
          `timeMin=${new Date(startTs * 1000).toISOString()}&` +
          `timeMax=${new Date(endTs * 1000).toISOString()}&` +
          `q=${encodeURIComponent('[TASK]')}&` +
          `singleEvents=true&orderBy=startTime&timeZone=Asia/Ho_Chi_Minh`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const gData = await gRes.json();

        for (const e of (gData.items || [])) {
          if (!e.summary?.includes('[TASK]')) continue;

          // Parse task info từ description
          const desc = e.description || '';
          const priority = desc.match(/Priority:\s*(\w+)/)?.[1] || 'medium';
          const assignee = desc.match(/Assigned to:\s*(.+)/)?.[1] || null;

          tasks.push({
            source: 'google',
            event_id: e.id,
            title: e.summary.replace('[TASK] ', ''),
            assignee,
            priority,
            due_date: toVNTime(e.start.dateTime || e.start.date),
            status: new Date(e.end.dateTime || e.end.date) < new Date() ? 'overdue' : 'pending',
            link: e.htmlLink,
          });
        }
      } catch (e) {
        console.error('Google tasks error:', e.message);
      }
    }
  }

  // ── Lấy tasks từ Lark Calendar ──
  if (user.lark_connected) {
    const token = await refreshLarkToken(user);
    if (token) {
      try {
        const lRes = await fetch(
          `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events?` +
          `start_time=${startTs}&end_time=${endTs}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const lData = await lRes.json();

        for (const e of (lData.data?.items || [])) {
          if (!e.summary?.includes('[TASK]')) continue;

          const desc = e.description || '';
          const priority = desc.match(/Priority:\s*(\w+)/)?.[1] || 'medium';
          const assignee = desc.match(/Assigned to:\s*(.+)/)?.[1] || null;

          tasks.push({
            source: 'lark',
            event_id: e.event_id,
            title: e.summary.replace('[TASK] ', ''),
            assignee,
            priority,
            due_date: toVNTime(new Date(parseInt(e.start_time?.timestamp) * 1000).toISOString()),
            status: parseInt(e.end_time?.timestamp) * 1000 < Date.now() ? 'overdue' : 'pending',
          });
        }
      } catch (e) {
        console.error('Lark tasks error:', e.message);
      }
    }
  }

  // Deduplicate (nếu task tồn tại trên cả 2 bên, giữ Google)
  const seen = new Set();
  const unique = tasks.filter(t => {
    const key = t.title + t.due_date;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Filter theo status nếu có
  const filtered = status ? unique.filter(t => t.status === status) : unique;

  return res.json({
    total: filtered.length,
    tasks: filtered,
  });
}
