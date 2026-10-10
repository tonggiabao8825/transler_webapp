import pg from "pg";
import { z } from "zod";
import type { Config } from "../shared/config.js";

export type SqlConnection = pg.Pool | pg.PoolClient;
export type SqlValue = string | number | boolean | Date | null;
export function database(config: Config): pg.Pool {
  return new pg.Pool({
    connectionString: config.TRANSLER_DATABASE_URL.replace(
      "postgresql+psycopg://",
      "postgresql://",
    ),
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
}
export async function rows<T extends z.ZodType>(
  connection: SqlConnection,
  sql: string,
  values: ReadonlyArray<SqlValue>,
  schema: T,
): Promise<Array<z.infer<T>>> {
  const result = await connection.query(sql, [...values]);
  return z.array(schema).parse(result.rows);
}
export async function transaction<T>(
  pool: pg.Pool,
  operation: (connection: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const result = await operation(connection);
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}
export async function audit(
  connection: SqlConnection,
  actor: string | null,
  action: string,
  target: string,
  detail: string,
): Promise<void> {
  await connection.query(
    "INSERT INTO audit_events (id,actor_id,action,target,detail,created_at) VALUES (gen_random_uuid(),$1,$2,$3,$4,NOW())",
    [actor, action, target, detail],
  );
}
