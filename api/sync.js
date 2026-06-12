import { neon } from '@neondatabase/serverless';

export const config = { maxDuration: 60 };

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  // Bảo vệ endpoint
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Lấy tất cả user đã kết nối cả 2 bên
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
      await syncUser(user);
      results.push({ user_id: user.id, ok: true });
    } catch (err) {
      console.error(`Sync failed for user ${user.id}:`, err.message);
      results.push({ user_id: user.id, ok: false, error: err.message });
    }
  }

  res.json({ synced: results.length, results });
}

// ─── Sync 1 user ─────────────────────────────────────────────

async function syncUser(user) {
  // Lấy thời điểm sync lần trước
  const [state] = await sql`
    SELECT val FROM sync_state
    WHERE user_id = ${user.id} AND key = 'synced_until'
  `;
  const syncedUntil = state ? Number(state.val) : Date.now() - 10 * 60_000;
  const since = new Date(syncedUntil).toISOString();

  // Refresh token nếu sắp hết hạn
  const googleToken = await getGoogleToken(user);
  const larkToken = await getLarkToken(user);

  await Promise.all([
    syncGoogleToLark(user, googleToken, larkToken, since),
    syncLarkToGoogle(user, googleToken, larkToken, since),
  ]);

  // Cập nhật thời điểm sync
  await sql`
    INSERT INTO sync_state (user_id, key, val)
    VALUES (${user.id}, 'synced_until', ${String(Date.now())})
    ON CONFLICT (user_id, key) DO UPDATE SET val = EXCLUDED.val
  `;
}

// ─── Google → Lark ───────────────────────────────────────────

async function syncGoogleToLark(user, googleToken, larkToken, since) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?updatedMin=${since}&singleEvents=true&orderBy=updated`,
    { headers: { Authorization: `Bearer ${googleToken}` } }
  );
  const { items = [] } = await res.json();

  for (const event of items) {
    // Bỏ qua event do chính mình sync sang để tránh loop
    if (event.description?.includes('[synced-from-lark]')) continue;

    const [mapping] = await sql`
      SELECT lark_event_id FROM event_map
      WHERE user_id = ${user.id} AND google_event_id = ${event.id}
    `;

    if (event.status === 'cancelled') {
      if (mapping) {
        await larkDeleteEvent(user, larkToken, mapping.lark_event_id);
        await sql`
          DELETE FROM event_map
          WHERE user_id = ${user.id} AND google_event_id = ${event.id}
        `;
      }
    } else if (mapping) {
      await larkUpdateEvent(user, larkToken, mapping.lark_event_id, googleToLark(event));
    } else {
      const larkEvent = await larkCreateEvent(user, larkToken, googleToLark(event));
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

// ─── Lark → Google ───────────────────────────────────────────

async function syncLarkToGoogle(user, googleToken, larkToken, since) {
  const sinceTs = Math.floor(new Date(since).getTime() / 1000);
  const calId = user.lark_user_id; // dùng primary calendar

  const res = await fetch(
    `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events?start_time=${sinceTs}`,
    { headers: { Authorization: `Bearer ${larkToken}` } }
  );
  const { data } = await res.json();

  for (const event of (data?.items || [])) {
    if (event.description?.includes('[synced-from-google]')) continue;

    const [mapping] = await sql`
      SELECT google_event_id FROM event_map
      WHERE user_id = ${user.id} AND lark_event_id = ${event.event_id}
    `;

    if (mapping) {
      await googleUpdateEvent(googleToken, mapping.google_event_id, larkToGoogle(event));
    } else {
      const gEvent = await googleCreateEvent(googleToken, larkToGoogle(event));
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

// ─── Format converters ───────────────────────────────────────

function googleToLark(e) {
  return {
    summary: e.summary || '(no title)',
    description: (e.description || '') + '\n[synced-from-google]',
    start_time: {
      timestamp: String(Math.floor(new Date(e.start.dateTime || e.start.date).getTime() / 1000))
    },
    end_time: {
      timestamp: String(Math.floor(new Date(e.end.dateTime || e.end.date).getTime() / 1000))
    },
  };
}

function larkToGoogle(e) {
  return {
    summary: e.summary || '(no title)',
    description: (e.description || '') + '\n[synced-from-lark]',
    start: {
      dateTime: new Date(Number(e.start_time.timestamp) * 1000).toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh'
    },
    end: {
      dateTime: new Date(Number(e.end_time.timestamp) * 1000).toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh'
    },
  };
}

// ─── Google token ────────────────────────────────────────────

async function getGoogleToken(user) {
  // Còn hạn thì dùng luôn
  if (user.google_access_token && user.google_token_expires_at > Date.now() + 60_000) {
    return user.google_access_token;
  }

  // Hết hạn thì refresh
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     user.google_client_id,
      client_secret: user.google_client_secret,
      refresh_token: user.google_refresh_token,
      grant_type:    'refresh_token',
    })
  });
  const { access_token, expires_in } = await res.json();

  // Lưu token mới vào DB
  await sql`
    UPDATE users SET
      google_access_token = ${access_token},
      google_token_expires_at = ${Date.now() + expires_in * 1000}
    WHERE id = ${user.id}
  `;

  return access_token;
}

// ─── Lark token ──────────────────────────────────────────────

async function getLarkToken(user) {
  if (user.lark_access_token && user.lark_token_expires_at > Date.now() + 60_000) {
    return user.lark_access_token;
  }

  const res = await fetch('https://open.larksuite.com/open-apis/authen/v1/refresh_access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type:    'refresh_token',
      refresh_token: user.lark_refresh_token,
      app_id:        user.lark_app_id,
      app_secret:    user.lark_app_secret,
    })
  });
  const { data } = await res.json();

  await sql`
    UPDATE users SET
      lark_access_token = ${data.access_token},
      lark_refresh_token = ${data.refresh_token},
      lark_token_expires_at = ${Date.now() + data.expires_in * 1000}
    WHERE id = ${user.id}
  `;

  return data.access_token;
}

// ─── Google API helpers ──────────────────────────────────────

async function googleCreateEvent(token, event) {
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    }
  );
  return res.json();
}

async function googleUpdateEvent(token, eventId, event) {
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    }
  );
}

// ─── Lark API helpers ────────────────────────────────────────

async function larkCreateEvent(user, token, event) {
  const res = await fetch(
    `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    }
  );
  const { data } = await res.json();
  return data?.event;
}

async function larkUpdateEvent(user, token, eventId, event) {
  await fetch(
    `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${eventId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    }
  );
}

async function larkDeleteEvent(user, token, eventId) {
  await fetch(
    `https://open.larksuite.com/open-apis/calendar/v4/calendars/primary/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    }
  );
}