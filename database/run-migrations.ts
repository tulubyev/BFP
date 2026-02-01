import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.EXTERNAL_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('No database connection string found. Set EXTERNAL_DATABASE_URL or DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: process.env.EXTERNAL_DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  
  try {
    console.log('Starting database migrations...\n');
    
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      console.log(`Running: ${file}`);
      await client.query(sql);
      console.log(`  ✓ Completed\n`);
    }
    
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function runSeeds(): Promise<void> {
  const client = await pool.connect();
  
  try {
    console.log('\nStarting database seeding...\n');
    
    const seedsDir = path.join(__dirname, 'seeds');
    const files = fs.readdirSync(seedsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    for (const file of files) {
      const filePath = path.join(seedsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      console.log(`Seeding: ${file}`);
      await client.query(sql);
      console.log(`  ✓ Completed\n`);
    }
    
    console.log('All seeds completed successfully!');
  } catch (error) {
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] || 'all';
  
  try {
    if (command === 'migrate' || command === 'all') {
      await runMigrations();
    }
    
    if (command === 'seed' || command === 'all') {
      await runSeeds();
    }
    
    console.log('\nDatabase setup complete!');
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
