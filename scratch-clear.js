import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

async function run() {
  const envPath = path.resolve(process.cwd(), '.env');
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl && fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();
  }
  
  if (!dbUrl) {
    console.log("No DB URL found");
    return;
  }

  const sql = neon(dbUrl);
  await sql`DELETE FROM sync_state`;
  console.log("Cleared sync state!");
}
run();
