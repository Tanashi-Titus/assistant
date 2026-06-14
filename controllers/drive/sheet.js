import { getUserById, refreshGoogleToken } from '../../lib/db.js';

export default async function handler(req, res) {
  const { uid, file_id, file_name, range } = req.query;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Invalid uid' });
  if (!user.google_connected) return res.status(400).json({ error: 'Google not connected' });

  const token = await refreshGoogleToken(user);
  if (!token) return res.status(500).json({ error: 'Failed to get Google token' });

  try {
    let targetFileId = file_id;
    if (file_name) {
      const q = `name = '${file_name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        targetFileId = searchData.files[0].id;
      } else {
        return res.status(404).json({ error: 'Không tìm thấy Google Sheet nào có tên: ' + file_name });
      }
    }

    if (!targetFileId) return res.status(400).json({ error: 'Bạn phải cung cấp file_id hoặc file_name' });

    let targetRange = range;
    if (!targetRange) {
      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetFileId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const metaData = await metaRes.json();
      if (metaData.error) {
        return res.status(400).json({ error: metaData.error.message });
      }
      
      const sheets = metaData.sheets || [];
      if (sheets.length === 0) {
        return res.status(404).json({ error: 'No sheets found in this document' });
      }
      targetRange = sheets[0].properties.title;
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${targetFileId}/values/${encodeURIComponent(targetRange)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();

    if (data.error) {
       return res.status(400).json({ error: data.error.message });
    }

    return res.json({
      file_id: targetFileId,
      range: targetRange,
      values: data.values || [],
    });
  } catch (e) {
    console.error('Drive sheet error:', e);
    return res.status(500).json({ error: e.message });
  }
}
