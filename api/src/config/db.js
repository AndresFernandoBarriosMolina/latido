import pg from 'pg';
import { config } from './index.js';

export const pool = new pg.Pool({
  connectionString: config.db.url,
  max: 20,
  idleTimeoutMillis: 30000,
});

export const query = (text, params) => pool.query(text, params);

// Helper transaccional (importante para pagos/billetera/regalos)
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
