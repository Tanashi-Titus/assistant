import { getUserById, refreshGoogleToken } from '../../lib/db.js';

export default async function handler(req, res) {
  const { uid, q, folder_id } = req.query;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });
  if (!q) return res.status(400).json({ error: 'Missing q (search query)' });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Invalid uid' });
  if (!user.google_connected) return res.status(400).json({ error: 'Google not connected' });

  const token = await refreshGoogleToken(user);
  if (!token) return res.status(500).json({ error: 'Failed to get Google token' });

  try {
    let query = `name contains '${q.replace(/'/g, "\\'")}' and trashed = false`;
    if (folder_id) {
      query += ` and '${folder_id}' in parents`;
    }

    const url = `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(query)}&` +
      `fields=files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,owners)&` +
      `pageSize=50&orderBy=modifiedTime desc`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();

    if (data.error) {
       return res.status(400).json({ error: data.error.message });
    }

    const files = (data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      type: simplifyMimeType(f.mimeType),
      size: formatBytes(parseInt(f.size) || 0),
      modified: f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '',
      created: f.createdTime ? new Date(f.createdTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '',
      owner: f.owners?.[0]?.emailAddress || '',
      link: f.webViewLink || '',
    }));

    return res.json({
      query: q,
      total_results: files.length,
      files,
    });
  } catch (e) {
    console.error('Drive search error:', e);
    return res.status(500).json({ error: e.message });
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function simplifyMimeType(mime) {
  if (!mime) return 'unknown';
  if (mime.includes('folder')) return 'folder';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'spreadsheet';
  if (mime.includes('document') || mime.includes('word')) return 'document';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'presentation';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('image')) return 'image';
  if (mime.includes('video')) return 'video';
  if (mime.includes('audio')) return 'audio';
  if (mime.includes('zip') || mime.includes('archive') || mime.includes('compressed')) return 'archive';
  return 'file';
}
