import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import {
  audit,
  database,
  rows,
  transaction,
} from "./infrastructure/database.js";
import { registerAccount, tokenHash } from "./modules/identity/identity.js";
import { readConfig } from "./shared/config.js";
import { accountView, registration } from "./shared/contracts.js";
const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" } },
  allowPositionals: false,
});
const body = registration.parse({
  email: values.email,
  name: values.name,
  password: process.env.TRANSLER_ADMIN_PASSWORD,
});
const pool = database(readConfig());
try {
  const account = await transaction(pool, async (connection) => {
    await connection.query(
      "SELECT pg_advisory_xact_lock(hashtext('transler.admin.bootstrap'))",
    );
    if (
      (
        await rows(
          connection,
          "SELECT * FROM accounts WHERE role='admin' AND is_active=TRUE",
          [],
          accountView,
        )
      ).length
    )
      throw new Error(
        "An active administrator already exists. Use Administration to grant another administrator role.",
      );
    const owner = randomUUID();
    await connection.query(
      "INSERT INTO sessions(id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days')",
      [owner, tokenHash(randomBytes(32).toString("hex"))],
    );
    const account = await registerAccount(connection, owner, body);
    await connection.query("UPDATE accounts SET role='admin' WHERE id=$1", [
      account.id,
    ]);
    await audit(
      connection,
      account.id,
      "admin.bootstrap",
      account.id,
      "Initial administrator created through the deployment CLI.",
    );
    return account;
  });
  process.stdout.write(`Administrator created: ${account.email}\n`);
} finally {
  await pool.end();
}
