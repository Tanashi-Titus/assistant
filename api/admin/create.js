import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Kiểm tra admin password đơn giản
  const { admin_password, name, lark_app_id, lark_app_secret } = req.body || {};

  if (admin_password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Sai mật khẩu admin" });
  }

  if (!name || !lark_app_id || !lark_app_secret) {
    return res.status(400).json({ error: "Thiếu thông tin: name, lark_app_id, lark_app_secret" });
  }

  try {
    // Tạo user mới với lark app riêng
    const result = await sql`
      INSERT INTO users (name, lark_app_id, lark_app_secret)
      VALUES (${name}, ${lark_app_id}, ${lark_app_secret})
      RETURNING id, api_key
    `;

    const { id, api_key } = result[0];

    // Bật cả 2 tools
    await sql`
      INSERT INTO tool_config (user_id, tool_name, enabled)
      VALUES
        (${id}, 'lark_calendar', true),
        (${id}, 'google_calendar', true)
      ON CONFLICT DO NOTHING
    `;

    const baseUrl = process.env.BASE_URL || "https://assistant-git-main-akito-s-projects2.vercel.app";
    const setupLink = `${baseUrl}/setup.html?token=${api_key}`;

    return res.status(200).json({
      success: true,
      user: { id, name, api_key },
      setup_link: setupLink,
    });
  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ error: "Lỗi tạo user", detail: err.message });
  }
}