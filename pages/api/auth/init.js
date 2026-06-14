import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const { uid, service } = req.query;
  if (!uid || !service) return res.status(400).json({ error: "Missing uid or service" });

  const sql = neon(process.env.DATABASE_URL);
  const [user] = await sql`SELECT * FROM users WHERE id = ${uid}`;
  if (!user) return res.status(404).json({ error: "User not found" });

  if (service === "lark") {
    if (!user.lark_app_id) return res.status(400).json({ error: "Lark App ID chưa được cấu hình" });
    // Scopes: đọc/ghi calendar + đọc group chat + offline refresh
    const larkScopes = [
      "offline_access",
      "calendar:calendar:readonly",
      "calendar:calendar.event:read",
      "calendar:calendar.event:write",
      "calendar:calendar.event:delete",
      "im:chat:readonly",
      "im:message:readonly",
    ].join(" ");
    const url = `https://open.larksuite.com/open-apis/authen/v1/authorize?` +
      `client_id=${user.lark_app_id}` +
      `&redirect_uri=${encodeURIComponent(user.lark_redirect_uri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(larkScopes)}` +
      `&state=${uid}`;
    return res.json({ url });
  }

  if (service === "google") {
    if (!user.google_client_id) return res.status(400).json({ error: "Google Client ID chưa được cấu hình" });
    // Scopes: đọc/ghi calendar + đọc Drive
    const googleScopes = [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/drive.readonly",
    ].join(" ");
    const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${user.google_client_id}` +
      `&redirect_uri=${encodeURIComponent(user.google_redirect_uri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(googleScopes)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${uid}`;
    return res.json({ url });
  }

  return res.status(400).json({ error: "Service không hợp lệ" });
}