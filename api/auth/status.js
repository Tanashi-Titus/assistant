import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  const sql = neon(process.env.DATABASE_URL);
  const [user] = await sql`
    SELECT name, api_key, lark_connected, google_connected 
    FROM users WHERE id = ${uid}
  `;

  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(user);
}