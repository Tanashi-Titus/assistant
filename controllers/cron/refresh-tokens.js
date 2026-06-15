import { getDb, refreshGoogleToken, refreshLarkToken } from '../../lib/db.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // Bảo vệ endpoint — chỉ chạy từ Vercel Cron hoặc với CRON_SECRET
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET &&
      req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = getDb();
  const users = await sql`SELECT * FROM users`;

  const results = [];

  for (const user of users) {
    const status = { user_id: user.id, name: user.name, google: null, lark: null };

    // ── Refresh Google Token ──
    if (user.google_connected && user.google_refresh_token) {
      try {
        // Refresh nếu hết hạn trong 1 giờ tới
        if (user.google_token_expires_at < Date.now() + 60 * 60_000) {
          const newToken = await refreshGoogleToken(user);
          status.google = newToken ? 'refreshed' : 'failed';
        } else {
          status.google = 'still_valid';
        }
      } catch (e) {
        status.google = `error: ${e.message}`;
      }
    }

    // ── Refresh Lark Token ──
    if (user.lark_connected && user.lark_refresh_token) {
      try {
        // Luôn refresh Lark để gia hạn refresh_token (tránh hết hạn sau 7 ngày)
        const newToken = await refreshLarkToken(user);
        status.lark = newToken ? 'refreshed' : 'failed';
      } catch (e) {
        status.lark = `error: ${e.message}`;
      }
    }

    results.push(status);
  }

  return res.json({
    message: 'Token refresh complete',
    timestamp: new Date().toISOString(),
    users_processed: results.length,
    results,
  });
}
