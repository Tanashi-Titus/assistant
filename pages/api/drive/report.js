import { getUserById, refreshGoogleToken } from '../../../lib/db.js';

export default async function handler(req, res) {
  const { uid, folder_id, period, date } = req.query;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });
  if (!folder_id) return res.status(400).json({ error: 'Missing folder_id' });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Invalid uid' });
  if (!user.google_connected) return res.status(400).json({ error: 'Google not connected' });

  const token = await refreshGoogleToken(user);
  if (!token) return res.status(500).json({ error: 'Failed to get Google token' });

  const reportPeriod = period || 'week'; // day | week | month | quarter | year
  const refDate = date ? new Date(date) : new Date();
  const { start: periodStart, end: periodEnd, prevStart, prevEnd, label } = getDateRange(reportPeriod, refDate);

  try {
    // Lấy tên folder
    const folderRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folder_id}?fields=name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const folderData = await folderRes.json();
    const folderName = folderData.name || 'Unknown';

    // Lấy tất cả files trong folder
    const allFiles = await listAllFiles(token, folder_id);

    // Phân loại files theo period hiện tại
    const currentNew = allFiles.filter(f =>
      new Date(f.createdTime) >= periodStart && new Date(f.createdTime) <= periodEnd
    );
    const currentModified = allFiles.filter(f =>
      new Date(f.modifiedTime) >= periodStart && new Date(f.modifiedTime) <= periodEnd &&
      new Date(f.createdTime) < periodStart // chỉ tính file đã tồn tại từ trước
    );

    // Phân loại files theo period trước
    const prevNew = allFiles.filter(f =>
      new Date(f.createdTime) >= prevStart && new Date(f.createdTime) <= prevEnd
    );
    const prevModified = allFiles.filter(f =>
      new Date(f.modifiedTime) >= prevStart && new Date(f.modifiedTime) <= prevEnd &&
      new Date(f.createdTime) < prevStart
    );

    const totalSize = allFiles.reduce((s, f) => s + (parseInt(f.size) || 0), 0);

    // Timeline (phân theo ngày trong period)
    const timeline = buildTimeline(allFiles, periodStart, periodEnd);

    // Recent changes
    const recentChanges = allFiles
      .filter(f => new Date(f.modifiedTime) >= periodStart && new Date(f.modifiedTime) <= periodEnd)
      .sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime))
      .slice(0, 20)
      .map(f => ({
        file: f.name,
        action: new Date(f.createdTime) >= periodStart ? 'new' : 'modified',
        time: new Date(f.modifiedTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        by: f.lastModifyingUser?.emailAddress || f.owners?.[0]?.emailAddress || '',
      }));

    return res.json({
      folder: folderName,
      folder_id,
      period: reportPeriod,
      date_range: label,
      summary: {
        total_files: allFiles.length,
        new_files: currentNew.length,
        modified_files: currentModified.length,
        total_size: formatBytes(totalSize),
      },
      comparison: {
        previous_period: {
          new_files: prevNew.length,
          modified_files: prevModified.length,
        },
        change_percent: {
          new_files: calcPercent(prevNew.length, currentNew.length),
          modified_files: calcPercent(prevModified.length, currentModified.length),
        },
      },
      timeline,
      recent_changes: recentChanges,
    });
  } catch (e) {
    console.error('Drive report error:', e);
    return res.status(500).json({ error: e.message });
  }
}

// ── Helpers ──────────────────────────────────────────────────

function getDateRange(period, refDate) {
  const d = new Date(refDate);
  let start, end, prevStart, prevEnd;

  switch (period) {
    case 'day':
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      end = new Date(start); end.setDate(end.getDate() + 1);
      prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 1);
      prevEnd = new Date(start);
      break;
    case 'week':
      const dow = d.getDay() || 7; // Monday=1
      start = new Date(d); start.setDate(d.getDate() - dow + 1); start.setHours(0,0,0,0);
      end = new Date(start); end.setDate(end.getDate() + 7);
      prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
      prevEnd = new Date(start);
      break;
    case 'month':
      start = new Date(d.getFullYear(), d.getMonth(), 1);
      end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      prevStart = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      prevEnd = new Date(start);
      break;
    case 'quarter':
      const q = Math.floor(d.getMonth() / 3);
      start = new Date(d.getFullYear(), q * 3, 1);
      end = new Date(d.getFullYear(), q * 3 + 3, 1);
      prevStart = new Date(d.getFullYear(), q * 3 - 3, 1);
      prevEnd = new Date(start);
      break;
    case 'year':
      start = new Date(d.getFullYear(), 0, 1);
      end = new Date(d.getFullYear() + 1, 0, 1);
      prevStart = new Date(d.getFullYear() - 1, 0, 1);
      prevEnd = new Date(start);
      break;
    default:
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7);
      end = new Date(d);
      prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
      prevEnd = new Date(start);
  }

  const fmt = dt => dt.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return { start, end, prevStart, prevEnd, label: `${fmt(start)} → ${fmt(end)}` };
}

function buildTimeline(files, start, end) {
  const days = {};
  const cursor = new Date(start);
  while (cursor < end) {
    const key = cursor.toISOString().slice(0, 10);
    days[key] = { date: key, new: 0, modified: 0 };
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const f of files) {
    const cKey = f.createdTime?.slice(0, 10);
    const mKey = f.modifiedTime?.slice(0, 10);
    if (days[cKey]) days[cKey].new++;
    if (days[mKey] && cKey !== mKey) days[mKey].modified++;
  }

  return Object.values(days);
}

async function listAllFiles(token, folderId) {
  const all = [];
  let pageToken = '';
  do {
    const q = `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    const url = `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(q)}&` +
      `fields=nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,owners,lastModifyingUser,webViewLink)&` +
      `pageSize=100` +
      (pageToken ? `&pageToken=${pageToken}` : '');

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();
    all.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return all;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function calcPercent(prev, curr) {
  if (prev === 0 && curr === 0) return '0%';
  if (prev === 0) return '+100%';
  const pct = ((curr - prev) / prev * 100).toFixed(1);
  return (pct > 0 ? '+' : '') + pct + '%';
}
