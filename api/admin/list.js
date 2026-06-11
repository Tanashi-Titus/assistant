import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const { admin_password } = req.query;

  if (admin_password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Sai mật khẩu admin" });
  }

  try {
    const users = await sql`
      SELECT
        u.id,
        u.name,
        u.api_key,
        u.lark_app_id,
        u.lark_access_token IS NOT NULL AS lark_connected,
        u.google_access_token IS NOT NULL AS google_connected,
        u.created_at
      FROM users u
      ORDER BY u.created_at DESC
    `;

    const baseUrl = process.env.BASE_URL || "https://assistant-git-main-akito-s-projects2.vercel.app";

    return res.status(200).json({
      users: users.map(u => ({
        ...u,
        setup_link: `${baseUrl}/setup.html?token=${u.api_key}`
      }))
    });
  } catch (err) {
    console.error("List users error:", err);
    res.status(500).json({ error: "Lỗi lấy danh sách", detail: err.message });
  }
}