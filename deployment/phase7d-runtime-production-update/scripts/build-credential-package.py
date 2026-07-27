#!/usr/bin/env python3
"""Build an ephemeral, secret-free-at-rest Phase 7D credential import package."""

from __future__ import annotations

import json
import os
import pathlib
import secrets
import sys
from urllib.parse import unquote, urlsplit


SPECS = (
    (
        "tanaghom_phase7d_runtime_login",
        "tanaghom_agent_runtime",
        "7d000000-0000-4000-8000-000000000101",
        "Tanaghom Agent Runtime PostgreSQL",
    ),
    (
        "tanaghom_phase7d_read_login",
        "tanaghom_skill_read_executor",
        "7d100000-0000-4000-8000-000000000301",
        "Tanaghom Skill Read Executor PostgreSQL",
    ),
    (
        "tanaghom_phase7d_proposal_login",
        "tanaghom_skill_proposal_executor",
        "7d100000-0000-4000-8000-000000000302",
        "Tanaghom Skill Proposal Executor PostgreSQL",
    ),
    (
        "tanaghom_phase7d_action_login",
        "tanaghom_skill_action_executor",
        "7d100000-0000-4000-8000-000000000303",
        "Tanaghom Skill Action Executor PostgreSQL",
    ),
)


def write_private(path: pathlib.Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    os.chmod(path, 0o600)


def main() -> None:
    if len(sys.argv) != 6:
        raise SystemExit(
            "usage: build-credential-package.py DATABASE_URL_FILE "
            "ROLE_SQL CREDENTIAL_JSON PGPASS CONNECTION_TSV"
        )

    database_url_file, role_sql_path, credential_path, pgpass_path, connection_path = (
        pathlib.Path(value) for value in sys.argv[1:]
    )
    database_url = database_url_file.read_text(encoding="utf-8").strip()
    parsed = urlsplit(database_url)
    owner_user = unquote(parsed.username or "")
    project_suffix = owner_user.split(".", 1)[1] if "." in owner_user else ""
    host = parsed.hostname or ""
    port = parsed.port or 5432
    database = parsed.path.lstrip("/")
    if not host or not database:
        raise SystemExit("production database URL is incomplete")

    sql_lines: list[str] = []
    credentials: list[dict[str, object]] = []
    pgpass_lines: list[str] = []
    connection_lines: list[str] = []

    for role, capability, credential_id, credential_name in SPECS:
        password = secrets.token_hex(32)
        pooler_user = f"{role}.{project_suffix}" if project_suffix else role
        sql_lines.append(
            f"CREATE ROLE {role} LOGIN PASSWORD '{password}' "
            "NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT "
            f"NOREPLICATION NOBYPASSRLS IN ROLE {capability};"
        )
        credentials.append(
            {
                "id": credential_id,
                "name": credential_name,
                "type": "postgres",
                "data": {
                    "host": host,
                    "database": database,
                    "user": pooler_user,
                    "password": password,
                    "port": port,
                    "maxConnections": 4,
                    "allowUnauthorizedCerts": False,
                    "ssl": "require",
                },
            }
        )
        pgpass_lines.append(f"{host}:{port}:{database}:{pooler_user}:{password}")
        connection_lines.append(
            "\t".join((role, host, str(port), database, pooler_user))
        )

    write_private(role_sql_path, "\n".join(sql_lines) + "\n")
    write_private(credential_path, json.dumps(credentials, separators=(",", ":")))
    write_private(pgpass_path, "\n".join(pgpass_lines) + "\n")
    write_private(connection_path, "\n".join(connection_lines) + "\n")


if __name__ == "__main__":
    main()
