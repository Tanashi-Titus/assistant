import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) return res.status(400).json({ error: "Missing code" });

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      return res.status(400).json({ error: "Google OAuth failed", detail: tokenData.error_description });
    }

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiresAt = Date.now() + expires_in * 1000;

    await sql`
      UPDATE users SET
        google_access_token = ${access_token},
        google_refresh_token = ${refresh_token || null},
        google_token_expires_at = ${expiresAt}
      WHERE api_key = ${state}
    `;

    res.redirect(`/success.html?google=connected&api_key=${encodeURIComponent(state)}`);
  } catch (err) {
    console.error("Google callback error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}