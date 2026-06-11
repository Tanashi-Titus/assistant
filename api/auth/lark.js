import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).json({ error: "Missing code or state" });

  const sql = neon(process.env.DATABASE_URL);
  const [user] = await sql`SELECT * FROM users WHERE id = ${state}`;
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    // Lark dùng Basic Auth thay vì body params
    const credentials = Buffer.from(`${user.lark_app_id}:${user.lark_app_secret}`).toString("base64");

    const tokenRes = await fetch("https://open.larksuite.com/open-apis/authen/v2/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${credentials}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: user.lark_redirect_uri,
      }),
    });

    const result = await tokenRes.json();
    console.log("Lark token response:", JSON.stringify(result));

    const accessToken = result?.data?.access_token || result?.access_token;
    const refreshToken = result?.data?.refresh_token || result?.refresh_token;
    const expiresIn = result?.data?.expires_in || result?.expires_in || 7200;

    if (!accessToken) {
      console.error("No access token:", JSON.stringify(result));
      return res.status(400).json({ error: "Lark auth failed", detail: result });
    }

    await sql`
      UPDATE users SET
        lark_access_token = ${accessToken},
        lark_refresh_token = ${refreshToken || null},
        lark_token_expires_at = ${Date.now() + expiresIn * 1000},
        lark_connected = true
      WHERE id = ${state}
    `;

    return res.redirect(`/success.html?uid=${state}&service=lark`);

  } catch (err) {
    console.error("Lark auth error:", err);
    return res.status(500).json({ error: "Server error", detail: err.message });
  }
}