import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const sql = neon(process.env.DATABASE_URL);

  const users = await sql`
    SELECT 
      id, api_key, name,
      lark_app_id, google_client_id,
      lark_connected, google_connected,
      lark_calendar_enabled, google_calendar_enabled,
      created_at
    FROM users
    ORDER BY created_at DESC
  `;

  return res.status(200).json({ users });
}