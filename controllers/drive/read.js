import { getUserById, refreshGoogleToken } from '../../lib/db.js';

export default async function handler(req, res) {
  const { uid, file_id } = req.query;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });
  if (!file_id) return res.status(400).json({ error: 'Missing file_id' });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Invalid uid' });

  const token = await refreshGoogleToken(user);
  if (!token) return res.status(500).json({ error: 'Failed to get token' });

  try {
    // Lấy metadata để biết loại file
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file_id}?fields=id,name,mimeType`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = await metaRes.json();
    if (meta.error) return res.status(400).json({ error: meta.error.message });

    const { name, mimeType } = meta;
    let content = '';

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      // Google Sheets → export CSV
      const r = await fetch(
        `https://docs.google.com/spreadsheets/d/${file_id}/export?format=csv`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      content = await r.text();

    } else if (mimeType === 'application/vnd.google-apps.document') {
      // Google Docs → export plain text
      const r = await fetch(
        `https://docs.google.com/document/d/${file_id}/export?format=txt`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      content = await r.text();

    } else if (mimeType === 'text/csv' || mimeType === 'text/plain') {
      // CSV hoặc text file thường
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file_id}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      content = await r.text();

    } else {
      return res.status(400).json({ 
        error: `Không hỗ trợ đọc loại file: ${mimeType}`,
        supported: ['Google Sheets', 'Google Docs', 'CSV', 'TXT']
      });
    }

    // Giới hạn 50000 ký tự để không quá token limit
    const truncated = content.length > 50000;
    return res.json({
      file_id,
      file_name: name,
      mime_type: mimeType,
      content: content.slice(0, 50000),
      truncated,
      total_chars: content.length,
    });

  } catch (e) {
    console.error('Drive read error:', e);
    return res.status(500).json({ error: e.message });
  }
}