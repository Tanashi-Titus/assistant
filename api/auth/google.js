import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const { code, state } = req.query; // state = user id
  if (!code || !state) return res.status(400).json({ error: "Missing code or state" });

  const sql = neon(process.env.DATABASE_URL);

  const [user] = await sql`SELECT * FROM users WHERE id = ${state}`;
  if (!user) return res.status(404).json({ error: "User not found" });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: user.google_client_id,
      client_secret: user.google_client_secret,
      redirect_uri: user.google_redirect_uri,
      code,
    }),
  });

  const data = await tokenRes.json();
  if (!data.access_token) return res.status(400).json({ error: "Google auth failed" });

  await sql`
    UPDATE users SET
      google_access_token = ${data.access_token},
      google_refresh_token = ${data.refresh_token || null},
      google_token_expires_at = ${Date.now() + data.expires_in * 1000},
      google_connected = true
    WHERE id = ${state}
  `;

  res.redirect(`/success.html?uid=${state}&service=google`);
}