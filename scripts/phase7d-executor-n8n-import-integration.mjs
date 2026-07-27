import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const n8nImage = "docker.n8n.io/n8nio/n8n:2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd";
const postgresImage = "postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94";
const suffix = `${process.pid}-${Date.now()}`;
const network = `tanaghom-phase7d-import-${suffix}`;
const postgres = `tanaghom-phase7d-import-pg-${suffix}`;
const n8n = `tanaghom-phase7d-import-n8n-${suffix}`;
const workflows = [
  ["phase7dReadExecutorV1", "read-executor.v1.json"],
  ["phase7dProposalExecutorV1", "proposal-executor.v1.json"],
  ["phase7dActionExecutorV1", "action-executor.v1.json"],
  ["phase7dRuntimeFinalizerV1", "runtime-finalizer.v1.json"],
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n`
      + `${result.stdout || ""}${result.stderr || ""}`,
    );
  }
  return (result.stdout || "").trim();
}

function docker(...args) {
  return run("docker", args, { capture: true });
}

function sql(statement) {
  return docker(
    "exec",
    postgres,
    "psql",
    "-U",
    "postgres",
    "-d",
    "n8n_phase7d_import",
    "-X",
    "-At",
    "-c",
    statement,
  );
}

try {
  docker("network", "create", network);
  docker(
    "run",
    "-d",
    "--name",
    postgres,
    "--network",
    network,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_DB=n8n_phase7d_import",
    postgresImage,
  );
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const check = spawnSync(
      "docker",
      ["exec", postgres, "pg_isready", "-U", "postgres", "-d", "n8n_phase7d_import"],
      { stdio: "ignore" },
    );
    if (check.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(ready, true, "disposable PostgreSQL did not become ready");

  docker(
    "run",
    "-d",
    "--name",
    n8n,
    "--network",
    network,
    "-e",
    "N8N_ENCRYPTION_KEY=phase7d-import-disposable-key-32",
    "-e",
    "N8N_DIAGNOSTICS_ENABLED=false",
    "-e",
    "N8N_VERSION_NOTIFICATIONS_ENABLED=false",
    "-e",
    "DB_TYPE=postgresdb",
    "-e",
    `DB_POSTGRESDB_HOST=${postgres}`,
    "-e",
    "DB_POSTGRESDB_PORT=5432",
    "-e",
    "DB_POSTGRESDB_DATABASE=n8n_phase7d_import",
    "-e",
    "DB_POSTGRESDB_USER=postgres",
    "-e",
    "DB_POSTGRESDB_PASSWORD=postgres",
    "--entrypoint",
    "sh",
    n8nImage,
    "-c",
    "exec sleep 600",
  );
  docker("exec", "-u", "node", n8n, "n8n", "list:workflow", "--onlyId");

  for (const [id, filename] of workflows) {
    const source = join(
      process.cwd(),
      "n8n",
      "workflows",
      "phase7d",
      filename,
    );
    const remote = `/home/node/${filename}`;
    docker("cp", source, `${n8n}:${remote}`);
    docker(
      "exec",
      "-u",
      "node",
      n8n,
      "n8n",
      "import:workflow",
      `--input=${remote}`,
      "--activeState=false",
    );
    docker("exec", "-u", "node", n8n, "rm", "-f", remote);
    assert.equal(sql(`SELECT count(*) FROM workflow_entity WHERE id='${id}'`), "1");
  }

  assert.equal(sql("SELECT count(*) FROM workflow_entity"), "4");
  assert.equal(sql("SELECT count(*) FROM workflow_entity WHERE active IS TRUE"), "0");
  assert.equal(
    sql(`SELECT count(*)
      FROM workflow_entity workflow
      CROSS JOIN LATERAL jsonb_array_elements(workflow.nodes::jsonb) node
     WHERE node->>'type'='n8n-nodes-base.scheduleTrigger'
       AND coalesce((node->>'disabled')::boolean,false)=true`),
    "4",
  );
  assert.equal(sql("SELECT count(*) FROM execution_entity"), "0");
  const audit = docker("exec", "-u", "node", n8n, "n8n", "audit");
  assert.ok(audit.length > 0);
  console.log(
    "PASS: pinned disposable n8n imported all four Phase 7D executors inactive, "
    + "kept every schedule disabled, recorded zero executions, and completed audit.",
  );
} finally {
  spawnSync("docker", ["rm", "-f", n8n], { stdio: "ignore" });
  spawnSync("docker", ["rm", "-f", postgres], { stdio: "ignore" });
  spawnSync("docker", ["network", "rm", network], { stdio: "ignore" });
}
