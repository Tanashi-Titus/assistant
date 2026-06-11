import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name } = req.body || {};

  try {
    const result = await sql`
      INSERT INTO users (name)
      VALUES (${name || "Giám đốc"})
      RETURNING id, api_key
    `;

    const { id, api_key } = result[0];

    await sql`
      INSERT INTO tool_config (user_id, tool_name, enabled)
      VALUES
        (${id}, 'lark_calendar', true),
        (${id}, 'google_calendar', true)
      ON CONFLICT DO NOTHING
    `;

    const larkAuthUrl = new URL("https://open.larksuite.com/open-apis/authen/v1/index");
    larkAuthUrl.searchParams.set("app_id", process.env.LARK_APP_ID);
    larkAuthUrl.searchParams.set("redirect_uri", process.env.LARK_REDIRECT_URI);
    larkAuthUrl.searchParams.set("state", api_key);

    const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleAuthUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
    googleAuthUrl.searchParams.set("redirect_uri", process.env.GOOGLE_REDIRECT_URI);
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.readonly");
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("prompt", "consent");
    googleAuthUrl.searchParams.set("state", api_key);

    return res.status(200).json({
      api_key,
      lark_auth_url: larkAuthUrl.toString(),
      google_auth_url: googleAuthUrl.toString(),
    });
  } catch (err) {
    console.error("Init error:", err);
    res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}