import { getUserByApiKey, refreshGoogleToken, refreshLarkToken, getDb } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    api_key, title, description, assignee_email, assignee_name,
    due_date, priority, create_calendar_event
  } = req.body;
  if (!api_key) return res.status(400).json({ error: 'Missing api_key' });
  if (!title) return res.status(400).json({ error: 'Missing title' });

  const user = await getUserByApiKey(api_key);
  if (!user) return res.status(401).json({ error: 'Invalid api_key' });

  // Task = calendar event với prefix [TASK]
  const taskTitle = `[TASK] ${title}`;
  const taskDesc = [
    description || '',
    `📋 Priority: ${priority || 'medium'}`,
    assignee_name ? `👤 Assigned to: ${assignee_name}` : '',
    assignee_email ? `📧 Email: ${assignee_email}` : '',
    '[task-created-by-api]',
  ].filter(Boolean).join('\n');

  // Tính start/end từ due_date (mặc định = due_date 09:00-10:00)
  const dueMs = due_date ? new Date(due_date).getTime() : Date.now() + 24 * 3600 * 1000;
  const startTs = Math.floor(dueMs / 1000);
  const endTs = startTs + 3600; // 1 tiếng

  const result = { google: null, lark: null };
  const shouldCreate = create_calendar_event !== false; // mặc định true

  if (shouldCreate) {
    // ── Tạo trên Google Calendar ──
    if (user.google_connected) {
      const token = await refreshGoogleToken(user);
      if (token) {
        const gEvent = {
          summary: taskTitle,
          description: taskDesc,
          start: { dateTime: new Date(startTs * 1000).toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
          end: { dateTime: new Date(endTs * 1000).toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
        };
        if (assignee_email) {
          gEvent.attendees = [{ email: assignee_email }];
        }

        const gRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(gEvent),
        });
        const gData = await gRes.json();
        if (gData.id) result.google = { event_id: gData.id, link: gData.htmlLink };
      }
    }

    // ── Tạo trên Lark Calendar ──
    if (user.lark_connected) {
      const token = await refreshLarkToken(user);
      if (token) {
        const lEvent = {
          summary: taskTitle,
          description: taskDesc,
          start_time: { timestamp: String(startTs) },
          end_time: { timestamp: String(endTs) },
        };

        const lRes = await fetch('https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(lEvent),
        });
        const lData = await lRes.json();
        const larkEventId = lData.data?.event?.event_id;
        if (larkEventId) result.lark = { event_id: larkEventId };
      }
    }

    // Lưu mapping
    if (result.google?.event_id && result.lark?.event_id) {
      const sql = getDb();
      await sql`
        INSERT INTO event_map (user_id, google_event_id, lark_event_id, synced_at)
        VALUES (${user.id}, ${result.google.event_id}, ${result.lark.event_id}, ${Date.now()})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  return res.json({
    message: 'Task created',
    task: {
      title: taskTitle,
      assignee: assignee_name || assignee_email || null,
      priority: priority || 'medium',
      due_date: new Date(dueMs).toISOString(),
    },
    google_event: result.google,
    lark_event: result.lark,
  });
}
