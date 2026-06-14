import { neon } from '@neondatabase/serverless';
import fs from 'fs';

async function run() {
  const envContent = fs.readFileSync('.env', 'utf-8');
  const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();
  
  const sql = neon(dbUrl);
  const users = await sql`SELECT id, name, lark_connected, google_connected, lark_calendar_enabled, google_calendar_enabled, lark_token_expires_at, google_token_expires_at FROM users`;
  
  console.log(users);
}
run();
