import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const { code, state } = req.query; // state = user id
  if (!code || !state) return res.status(400).json({ error: "Missing code or state" });

  const sql = neon(process.env.DATABASE_URL);

  const [user] = await sql`SELECT * FROM users WHERE id = ${state}`;
  if (!user) return res.status(404).json({ error: "User not found" });

  // Dùng App credentials của chính user đó
  const tokenRes = await fetch("https://open.larksuite.com/open-apis/authen/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: user.lark_app_id,
      client_secret: user.lark_app_secret,
      code,
      redirect_uri: user.lark_redirect_uri,
    }),
  });

  const { data } = await tokenRes.json();
  if (!data?.access_token) return res.status(400).json({ error: "Lark auth failed" });

  await sql`
    UPDATE users SET
      lark_access_token = ${data.access_token},
      lark_refresh_token = ${data.refresh_token},
      lark_token_expires_at = ${Date.now() + data.expires_in * 1000},
      lark_connected = true
    WHERE id = ${state}
  `;

  res.redirect(`/success.html?uid=${state}&service=lark`);
}