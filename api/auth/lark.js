import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) return res.status(400).json({ error: "Missing code" });

  try {
    const tokenRes = await fetch("https://open.larksuite.com/open-apis/authen/v1/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        app_id: process.env.LARK_APP_ID,
        app_secret: process.env.LARK_APP_SECRET,
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