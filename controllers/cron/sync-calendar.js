import { getDb, refreshGoogleToken, getLarkTenantToken } from '../../lib/db.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET &&
      req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = getDb();

  const users = await sql`
    SELECT * FROM users
    WHERE google_connected = true
      AND lark_connected = true
      AND google_calendar_enabled = true
      AND lark_calendar_enabled = true
  `;

  const results = [];

  for (const user of users) {
    try {
      await syncUser(user, sql);
      results.push({ user_id: user.id, ok: true });
    } catch (err) {
      console.error(`Sync failed for user ${user.id}:`, err.message);
      results.push({ user_id: user.id, ok: false, error: err.message });
    }
  }

  res.json({ synced: results.length, results });
}

// ── Sync 1 user ──────────────────────────────────────────────

async function syncUser(user, sql) {
  const [state] = await sql`
    SELECT val FROM sync_state
    WHERE user_id = ${user.id} AND key = 'synced_until'
  `;
  const since = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString();

  const googleToken = await refreshGoogleToken(user);
  const larkToken = await getLarkTenantToken(user);

  await Promise.all([
    syncGoogleToLark(user, googleToken, larkToken, since, sql),
    syncLarkToGoogle(user, googleToken, larkToken, since, sql),
  ]);
}

// ── Google → Lark ────────────────────────────────────────────

async function syncGoogleToLark(user, googleToken, larkToken, since, sql) {
  const futureTs = Math.floor((Date.now() + 365 * 24 * 60 * 60_000) / 1000);
  const r = await fetch(
    `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events?start_time=${sinceTs}&end_time=${futureTs}`,
    { headers: { Authorization: `Bearer ${googleToken}` } }
  );
  const { items = [] } = await r.json();

  for (const event of items) {
    if (event.description?.includes('[synced-from-lark]')) continue;

    const [mapping] = await sql`
      SELECT lark_event_id FROM event_map
      WHERE user_id = ${user.id} AND google_event_id = ${event.id}
    `;

    if (event.status === 'cancelled') {
      if (mapping) {
        await larkDelete(larkToken, mapping.lark_event_id);
        await sql`DELETE FROM event_map WHERE user_id = ${user.id} AND google_event_id = ${event.id}`;
      }
    } else if (mapping) {
      await larkUpdate(larkToken, mapping.lark_event_id, googleToLark(event));
    } else {
      const larkEvent = await larkCreate(larkToken, googleToLark(event));
      if (larkEvent?.event_id) {
        await sql`
          INSERT INTO event_map (user_id, google_event_id, lark_event_id, synced_at)
          VALUES (${user.id}, ${event.id}, ${larkEvent.event_id}, ${Date.now()})
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }
}

// ── Lark → Google ────────────────────────────────────────────

async function syncLarkToGoogle(user, googleToken, larkToken, since, sql) {
  const sinceTs = Math.floor(new Date(since).getTime() / 1000);

  const r = await fetch(
    `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events?start_time=${sinceTs}`,
    { headers: { Authorization: `Bearer ${larkToken}` } }
  );
  const { data } = await r.json();

  for (const event of (data?.items || [])) {
    if (event.description?.includes('[synced-from-google]')) continue;

    const [mapping] = await sql`
      SELECT google_event_id FROM event_map
      WHERE user_id = ${user.id} AND lark_event_id = ${event.event_id}
    `;

    if (mapping) {
      await googleUpdate(googleToken, mapping.google_event_id, larkToGoogle(event));
    } else {
      const gEvent = await googleCreate(googleToken, larkToGoogle(event));
      if (gEvent?.id) {
        await sql`
          INSERT INTO event_map (user_id, google_event_id, lark_event_id, synced_at)
          VALUES (${user.id}, ${gEvent.id}, ${event.event_id}, ${Date.now()})
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }
}

// ── Format converters ────────────────────────────────────────

function googleToLark(e) {
  return {
    summary: e.summary || '(no title)',
    description: (e.description || '') + '\n[synced-from-google]',
    start_time: { timestamp: String(Math.floor(new Date(e.start.dateTime || e.start.date).getTime() / 1000)) },
    end_time: { timestamp: String(Math.floor(new Date(e.end.dateTime || e.end.date).getTime() / 1000)) },
  };
}

function larkToGoogle(e) {
  return {
    summary: e.summary || '(no title)',
    description: (e.description || '') + '\n[synced-from-lark]',
    start: { dateTime: new Date(Number(e.start_time.timestamp) * 1000).toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
    end: { dateTime: new Date(Number(e.end_time.timestamp) * 1000).toISOString(), timeZone: 'Asia/Ho_Chi_Minh' },
  };
}

// ── API helpers ──────────────────────────────────────────────

async function googleCreate(token, event) {
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  return r.json();
}

async function googleUpdate(token, eventId, event) {
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

async function larkCreate(token, event) {
  const r = await fetch('https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  const { data } = await r.json();
  return data?.event;
}

async function larkUpdate(token, eventId, event) {
  await fetch(`https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${eventId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

async function larkDelete(token, eventId) {
  await fetch(`https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}
