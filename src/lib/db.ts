import pg from 'pg';

const { Pool } = pg;

// Create connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging'
    ? { rejectUnauthorized: false }
    : undefined,
});

// Test connection on startup
pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

/**
 * Get a setting from the database
 */
export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const { rows } = await pool.query(
    'SELECT value FROM settings WHERE key = $1',
    [key]
  );
  return rows[0]?.value ?? null;
}

/**
 * Update a setting in the database
 */
export async function setSetting(key: string, value: unknown, userId?: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value = $2,
       updated_by = $3,
       updated_at = NOW()`,
    [key, JSON.stringify(value), userId]
  );
}

/**
 * Validate database connection
 */
export async function validateDbConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    const { rows } = await pool.query('SELECT NOW() as time');
    console.log('Database connected:', rows[0].time);
    return { connected: true };
  } catch (error: any) {
    console.error('Database connection failed:', error.message);
    return { connected: false, error: error.message };
  }
}
