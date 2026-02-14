import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'cecelia',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD,
});

async function runMigration(filename: string) {
  const migrationPath = path.join(__dirname, filename);
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  try {
    console.log(`Running migration: ${filename}`);
    await pool.query(sql);
    console.log(`✅ Migration completed: ${filename}`);
  } catch (error) {
    console.error(`❌ Migration failed: ${filename}`);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the ai_video_generations migration
runMigration('20260213_create_ai_video_generations.sql')
  .then(() => {
    console.log('All migrations completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration error:', error);
    process.exit(1);
  });
