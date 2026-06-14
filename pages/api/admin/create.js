import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    name,
    lark_app_id,
    lark_app_secret,
    google_client_id,
    google_client_secret,
  } = req.body;

  if (!name) return res.status(400).json({ error: "name is required" });

  const sql = neon(process.env.DATABASE_URL);

  const base = process.env.BASE_URL || "https://assistant-xxx.vercel.app";

  const [user] = await sql`
    INSERT INTO users (
      name,
      lark_app_id, lark_app_secret,
      lark_redirect_uri,
      google_client_id, google_client_secret,
      google_redirect_uri
    ) VALUES (
      ${name},
      ${lark_app_id || null}, ${lark_app_secret || null},
      ${base + "/api/auth/lark"},
      ${google_client_id || null}, ${google_client_secret || null},
      ${base + "/api/auth/google"}
    )
    RETURNING id, api_key, name
  `;

  return res.status(200).json({
    message: "User created",
    user_id: user.id,
    api_key: user.api_key,
    name: user.name,
    setup_url: `${base}/setup.html?uid=${user.id}`,
  });
}