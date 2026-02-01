import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

let pool: Pool;

const connectionString = process.env.EXTERNAL_DATABASE_URL || process.env.DATABASE_URL;

if (connectionString) {
  pool = new Pool({
    connectionString: connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.EXTERNAL_DATABASE_URL ? { rejectUnauthorized: false } : undefined,
  });
} else {
  const dbConfig: PoolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'baikal_gis',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  pool = new Pool(dbConfig);
}

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err.stack);
  } else {
    console.log('Database connected successfully to:', connectionString ? 'external database' : 'local database');
  }
});

export default pool;