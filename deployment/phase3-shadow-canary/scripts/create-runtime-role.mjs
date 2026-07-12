import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

let password = "";
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/[\r\n]+$/, "");
if (password.length < 32) throw new Error("runtime password must be at least 32 characters");

const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query("BEGIN");
  const exists = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tanaghom_n8n_runtime') AS present",
  );
  if (!exists.rows[0].present) {
    await client.query(
      "CREATE ROLE tanaghom_n8n_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS",
    );
  }
  const statement = await client.query(
    "SELECT format('ALTER ROLE tanaghom_n8n_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text) AS sql",
    [password],
  );
  await client.query(statement.rows[0].sql);
  await client.query("GRANT tanaghom_n8n_worker TO tanaghom_n8n_runtime");
  const unexpected = await client.query(`
    SELECT granted.rolname
    FROM pg_auth_members membership
    JOIN pg_roles member ON member.oid = membership.member
    JOIN pg_roles granted ON granted.oid = membership.roleid
    WHERE member.rolname = 'tanaghom_n8n_runtime'
      AND granted.rolname <> 'tanaghom_n8n_worker'
  `);
  if (unexpected.rowCount) throw new Error("runtime login has unexpected memberships");
  await client.query("COMMIT");
  console.log("Restricted Supabase runtime login created or rotated.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  password = "";
  await client.end();
}
