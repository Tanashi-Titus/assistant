import { getUserByApiKey, refreshGoogleToken } from '../../lib/db.js';

export default async function handler(req, res) {
  const { api_key, folder_id, recursive } = req.query;
  if (!api_key) return res.status(400).json({ error: 'Missing api_key' });
  if (!folder_id) return res.status(400).json({ error: 'Missing folder_id' });

  const user = await getUserByApiKey(api_key);
  if (!user) return res.status(401).json({ error: 'Invalid api_key' });
  if (!user.google_connected) return res.status(400).json({ error: 'Google not connected' });

  const token = await refreshGoogleToken(user);
  if (!token) return res.status(500).json({ error: 'Failed to get Google token' });

  try {
    const files = await listFolder(token, folder_id, recursive === 'true');

    // Lấy tên folder
    const folderRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folder_id}?fields=name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const folderData = await folderRes.json();

    const totalSize = files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);

    return res.json({
      folder_id,
      folder_name: folderData.name || 'Unknown',
      total_files: files.length,
      total_size: formatBytes(totalSize),
      files: files.map(f => ({
        id: f.id,
        name: f.name,
        type: simplifyMimeType(f.mimeType),
        size: formatBytes(f.size_bytes || 0),
        modified: f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '',
        created: f.createdTime ? new Date(f.createdTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '',
        owner: f.owners?.[0]?.emailAddress || '',
        link: f.webViewLink || '',
      })),
    });
  } catch (e) {
    console.error('Drive list error:', e);
    return res.status(500).json({ error: e.message });
  }
}

async function listFolder(token, folderId, recursive, allFiles = []) {
  let pageToken = '';
  do {
    const query = `'${folderId}' in parents and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(query)}&` +
      `fields=nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,owners)&` +
      `pageSize=100&orderBy=modifiedTime desc` +
      (pageToken ? `&pageToken=${pageToken}` : '');

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();

    for (const file of (data.files || [])) {
      file.size_bytes = parseInt(file.size) || 0;
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        if (recursive) {
          await listFolder(token, file.id, true, allFiles);
        }
      } else {
        allFiles.push(file);
      }
    }

    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return allFiles;
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
