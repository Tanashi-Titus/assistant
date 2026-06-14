import { getUserById, refreshLarkToken } from '../../lib/db.js';

export default async function handler(req, res) {
  const { uid, chat_id, limit, since } = req.query;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });
  if (!chat_id) return res.status(400).json({ error: 'Missing chat_id' });

  const user = await getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Invalid uid' });
  if (!user.lark_connected) return res.status(400).json({ error: 'Lark not connected' });

  const token = await refreshLarkToken(user);
  if (!token) return res.status(500).json({ error: 'Failed to get Lark token' });

  const msgLimit = Math.min(parseInt(limit) || 50, 200);

  try {
    // Lấy thông tin group
    const chatRes = await fetch(
      `https://open.larksuite.com/open-apis/im/v1/chats/${chat_id}?user_id_type=open_id`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const chatData = await chatRes.json();
    const chatName = chatData.data?.name || 'Unknown';

    // Lấy tin nhắn
    let url = `https://open.larksuite.com/open-apis/im/v1/messages?` +
      `container_id_type=chat&container_id=${chat_id}&page_size=${Math.min(msgLimit, 50)}`;
    if (since) url += `&start_time=${since}`;

    const messages = [];
    let pageToken = '';
    let fetched = 0;

    do {
      const fetchUrl = pageToken ? `${url}&page_token=${pageToken}` : url;
      const r = await fetch(fetchUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();

      for (const msg of (data.data?.items || [])) {
        if (fetched >= msgLimit) break;

        const parsed = parseMessage(msg);
        if (parsed) {
          messages.push(parsed);
          fetched++;
        }
      }

      pageToken = (fetched < msgLimit) ? (data.data?.page_token || '') : '';
    } while (pageToken && fetched < msgLimit);

    // Sắp xếp theo thời gian mới nhất
    messages.sort((a, b) => b.timestamp - a.timestamp);

    // Summary hint cho GPT
    const senderCounts = {};
    messages.forEach(m => {
      senderCounts[m.sender] = (senderCounts[m.sender] || 0) + 1;
    });
    const activeSenders = Object.entries(senderCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} (${count} msgs)`);

    const hasFiles = messages.some(m => m.type === 'file' || m.type === 'media' || m.type === 'image');
    const hasMentions = messages.some(m => m.content?.includes('@'));

    const timeRange = messages.length > 0
      ? `${formatVNTime(messages[messages.length - 1].timestamp)} → ${formatVNTime(messages[0].timestamp)}`
      : 'N/A';

    return res.json({
      chat_name: chatName,
      chat_id,
      message_count: messages.length,
      time_range: timeRange,
      messages: messages.map(({ timestamp, ...rest }) => rest),
      summary_hint: {
        total_messages: messages.length,
        active_senders: activeSenders.slice(0, 10),
        has_files: hasFiles,
        has_mentions: hasMentions,
      },
    });
  } catch (e) {
    console.error('Lark messages error:', e);
    return res.status(500).json({ error: e.message });
  }
}

// ── Parse Lark message ───────────────────────────────────────

function parseMessage(msg) {
  try {
    const createTime = parseInt(msg.create_time) || 0;
    const senderName = msg.sender?.sender_type === 'user'
      ? (msg.sender?.tenant_key || msg.sender?.id || 'Unknown')
      : 'Bot';

    let type = msg.msg_type || 'text';
    let content = '';

    const body = msg.body?.content ? JSON.parse(msg.body.content) : {};

    switch (msg.msg_type) {
      case 'text':
        content = body.text || '';
        break;
      case 'post':
        content = extractPostContent(body);
        type = 'post';
        break;
      case 'image':
        content = '[Image]';
        type = 'image';
        break;
      case 'file':
        content = `[File: ${body.file_name || 'unknown'}]`;
        type = 'file';
        break;
      case 'audio':
        content = '[Audio message]';
        type = 'media';
        break;
      case 'video':
        content = '[Video]';
        type = 'media';
        break;
      case 'sticker':
        content = '[Sticker]';
        type = 'sticker';
        break;
      case 'interactive':
        content = body.header?.title?.content || '[Interactive card]';
        type = 'card';
        break;
      case 'share_chat':
        content = `[Shared group: ${body.chat_name || ''}]`;
        break;
      case 'share_user':
        content = `[Shared contact]`;
        break;
      case 'system':
        content = body.text || '[System message]';
        type = 'system';
        break;
      default:
        content = `[${msg.msg_type || 'unknown'}]`;
    }

    return {
      sender: senderName,
      time: formatVNTime(createTime),
      timestamp: createTime,
      type,
      content,
    };
  } catch {
    return null;
  }
}

function extractPostContent(body) {
  // Post format: { title, content: [[{tag, text}, ...], ...] }
  const parts = [];
  if (body.title) parts.push(body.title);

  const content = body.content || body.zh_cn?.content || body.en_us?.content || [];
  for (const paragraph of content) {
    const line = (paragraph || [])
      .map(item => {
        if (item.tag === 'text') return item.text;
        if (item.tag === 'a') return `[${item.text}](${item.href})`;
        if (item.tag === 'at') return `@${item.user_name || item.user_id || 'someone'}`;
        if (item.tag === 'img') return '[Image]';
        return '';
      })
      .join('');
    if (line) parts.push(line);
  }

  return parts.join('\n');
}

function formatVNTime(timestamp) {
  if (!timestamp) return '';
  // Lark timestamp = milliseconds string hoặc seconds
  const ms = timestamp > 9999999999 ? timestamp : timestamp * 1000;
  return new Date(ms).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}
