import { getUserById, getLarkTenantToken } from '../../lib/db.js';

export default async function handler(req, res) {
  const { uid, keyword } = req.query;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Invalid uid' });
  if (!user.lark_connected) return res.status(400).json({ error: 'Lark not connected' });

  const token = await getLarkTenantToken(user);
  if (!token) return res.status(500).json({ error: 'Failed to get Lark tenant token' });

  try {
    const groups = [];
    let pageToken = '';

    do {
      const url = `https://open.larksuite.com/open-apis/im/v1/chats?` +
        `user_id_type=open_id&page_size=50` +
        (pageToken ? `&page_token=${pageToken}` : '');

      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();

      for (const chat of (data.data?.items || [])) {
        // Filter theo keyword nếu có
        if (keyword && !chat.name?.toLowerCase().includes(keyword.toLowerCase())) continue;

        groups.push({
          chat_id: chat.chat_id,
          name: chat.name || '(no name)',
          description: chat.description || '',
          members: chat.user_count || 0,
          owner_id: chat.owner_id || '',
          chat_type: chat.chat_mode || 'group',
        });
      }

      pageToken = data.data?.page_token || '';
    } while (pageToken);

    return res.json({
      total: groups.length,
      keyword: keyword || null,
      groups,
    });
  } catch (e) {
    console.error('Lark groups error:', e);
    return res.status(500).json({ error: e.message });
  }
}
