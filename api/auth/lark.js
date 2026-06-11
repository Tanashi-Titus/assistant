import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) return res.status(400).json({ error: "Missing code" });

  try {
    // Lấy lark_app_id/secret của user này
    const users = await sql`
      SELECT id, lark_app_id, lark_app_secret
      FROM users WHERE api_key = ${state}
    `;

    if (users.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = users[0];
    const appId = user.lark_app_id;
    const appSecret = user.lark_app_secret;

    if (!appId || !appSecret) {
      return res.status(400).json({ error: "User chưa có Lark App ID/Secret" });
    }

    const tokenRes = await fetch("https://open.larksuite.com/open-apis/authen/v1/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        app_id: appId,
        app_secret: appSecret,
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0) {
      return res.status(400).json({ error: "Lark OAuth failed", detail: tokenData.msg });
    }

    const { access_token, refresh_token, expires_in } = tokenData.data;
    const expiresAt = Date.now() + expires_in * 1000;

    await sql`
      UPDATE users SET
        lark_access_token = ${access_token},
        lark_refresh_token = ${refresh_token},
        lark_token_expires_at = ${expiresAt}
      WHERE api_key = ${state}
    `;

    res.redirect(`/success.html?lark=connected&api_key=${encodeURIComponent(state)}`);
  } catch (err) {
    console.error("Lark callback error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}