import { getDb } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = getDb();
  await sql`DELETE FROM sync_state`;
  
  res.json({ message: "Đã reset trạng thái đồng bộ thành công. Cron job tiếp theo sẽ quét toàn bộ lịch cũ 30 ngày!" });
}
