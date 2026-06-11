import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const { api_key } = req.query;
  if (!api_key) return res.status(400).json({ error: "Missing api_key" });

  try {
    const rows = await sql`
      SELECT
        name,
        api_key,
        lark_access_token IS NOT NULL AS lark_connected,
        google_access_token IS NOT NULL AS google_connected
      FROM users WHERE api_key = ${api_key}
    `;
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    return res.status(200).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}