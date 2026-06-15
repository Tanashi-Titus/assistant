import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).json({ error: "Missing code or state" });

  const sql = neon(process.env.DATABASE_URL);
  const [user] = await sql`SELECT * FROM users WHERE id = ${state}`;
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
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
    const accessToken = result?.data?.access_token || result?.access_token;
    const refreshToken = result?.data?.refresh_token || result?.refresh_token;
    const expiresIn = result?.data?.expires_in || result?.expires_in || 7200;

    console.log("Lark token result:", JSON.stringify(result));
    if (!accessToken) {
      return res.status(400).json({ error: "Lark auth failed", detail: result });
    }

    // Decode JWT lấy open_id
    let larkUserId = null;
    try {
      const payload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      console.log("JWT payload:", JSON.stringify(payload));
      larkUserId = payload?.uid || payload?.user_id || payload?.open_id || null;
    } catch (e) {
      console.log("JWT decode failed:", e.message);
    }

    // Lấy user info qua API
    try {
      const userRes = await fetch("https://open.larksuite.com/open-apis/authen/v1/user_info", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const userInfo = await userRes.json();
      console.log("Lark user info:", JSON.stringify(userInfo));
      larkUserId = userInfo?.data?.open_id || larkUserId;
    } catch (e) {
      console.log("User info failed:", e.message);
    }

    console.log("Final lark_user_id:", larkUserId);

    await sql`
      UPDATE users SET
        lark_access_token = ${accessToken},
        lark_refresh_token = ${refreshToken || null},
        lark_token_expires_at = ${Date.now() + expiresIn * 1000},
        lark_connected = true,
        lark_user_id = ${larkUserId}
      WHERE id = ${state}
    `;

    return res.redirect(`/success.html?uid=${state}&service=lark`);

  } catch (err) {
    console.error("Lark auth error:", err);
    return res.status(500).json({ error: "Server error", detail: err.message });
  }
}