"""Validate the demo Compose JSON and private runtime files before startup."""
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

config = json.load(sys.stdin)
services = config["services"]
root = Path(__file__).resolve().parents[3]
migrations = sorted((root / "packages/database/migrations").glob("*.up.sql"))
assert len(migrations) == 48, "demo source must contain the exact 48-migration chain"
assert migrations[-1].name == "0051_agent_audit_organization.up.sql"
assert len({path.name.split("_", 1)[0] for path in migrations}) == 48
# The workspace profile is always validated. Caddy is optional because it lives
# behind the https profile and deploy/validate enable only the workspace profile;
# when the https profile is enabled, its full contract is validated too.
core = {"postgres", "migrate", "auth", "storage", "storage-init", "dashboard", "workspace-worker"}
assert set(services) in (core, core | {"caddy"}), "unexpected demo services"

for name in core - {"dashboard"}:
    assert not services[name].get("ports"), f"{name}: host port is forbidden"

node_image = "node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd"
postgres_image = "postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94"
rustfs_image = "rustfs/rustfs:latest@sha256:9ca9559533b537d10482fe923288b676ad08f92a7069d9a17327fbae3cab688b"
assert services["postgres"]["image"] == postgres_image
assert services["migrate"]["image"] == postgres_image
assert services["auth"]["image"].startswith("tanaghom-dashboard-demo:")
assert services["storage-init"]["image"] == node_image
assert services["storage"]["image"] == rustfs_image
assert services["dashboard"]["image"].startswith("tanaghom-dashboard-demo:")
assert services["workspace-worker"]["image"] == node_image
assert services["workspace-worker"]["profiles"] == ["workspace"]
assert services["workspace-worker"]["read_only"] is True
assert services["workspace-worker"]["command"] == ["node", "/app/worker.mjs"]
assert services["workspace-worker"]["environment"]["WORKSPACE_WORKER_TOKEN_FILE"] == "/run/secrets/workspace_worker_token"

ports = services["dashboard"].get("ports") or []
assert len(ports) == 1, "dashboard must publish exactly one loopback port"
port = ports[0]
assert port.get("host_ip") == "127.0.0.1", "dashboard must bind only loopback"
assert int(port.get("published")) == 3210, "dashboard must use private port 3210"
assert int(port.get("target")) == 3000, "dashboard container port must be 3000"
assert all("3200" not in str(value) for value in [ports, services["dashboard"].get("environment")])

if "caddy" in services:
    caddy = services["caddy"]
    assert caddy["profiles"] == ["https"], "caddy must be profile-gated"
    assert caddy["image"].startswith("caddy:2.10.2-alpine@sha256:"), "caddy must be pinned by digest"
    assert caddy["read_only"] is True
    assert set(caddy["networks"]) == {"edge", "backend"}
    caddy_ports = {(int(item["published"]), int(item["target"])) for item in caddy.get("ports") or []}
    assert caddy_ports == {(80, 80), (443, 443)}, "caddy must publish only 80/443"
    # Compose resolves ${TANAGHOM_PUBLIC_DOMAIN:-} to an empty string until the host
    # .env supplies it; the entrypoint refuses to start in that state.
    assert "TANAGHOM_PUBLIC_DOMAIN" in caddy["environment"], "public domain must come from the host env"
    assert "TANAGHOM_POSTIZ_DOMAIN" in caddy["environment"]
    assert caddy["entrypoint"] == ["/bin/sh", "/entrypoint.sh"]

assert services["auth"]["environment"]["AUTH_STORE_FILE"] == "/data/auth-users.json"
assert services["auth"]["environment"]["AUTH_SEED_FILE"] == "/run/secrets/auth_users"
assert services["auth"]["environment"]["AUTH_DATABASE_URL_FILE"] == "/run/secrets/database_url"
assert services["auth"]["environment"]["AUTH_INTERNAL_TOKEN_FILE"] == "/run/secrets/auth_internal_token"
assert int(services["auth"]["environment"]["AUTH_ACCESS_TTL_SECONDS"]) <= 3600
legacy_mounts = {mount.get("target"): mount for mount in services["auth"].get("volumes", [])}
assert "/data" in legacy_mounts, "legacy account store mount is required for the one-time import"
assert legacy_mounts["/data"].get("read_only") is True, "the legacy account store is import-only"

def secret_names(service):
    return {item if isinstance(item, str) else item["source"] for item in service.get("secrets", [])}

assert "auth_users" not in secret_names(services["dashboard"])
assert {"auth_users", "auth_private_key", "auth_internal_token", "database_url"} <= secret_names(services["auth"])
assert {"workspace_database_url", "workspace_worker_token", "gemini_api_key"} <= secret_names(services["dashboard"])
assert secret_names(services["workspace-worker"]) == {"workspace_worker_token"}
assert "workspace_password" in secret_names(services["migrate"])

assert config["networks"]["backend"]["internal"] is True, "backend network must be internal"
assert config["name"] == "tanaghom-dashboard-demo"
assert services["dashboard"]["read_only"] is True
assert services["auth"]["read_only"] is True
assert services["storage"]["read_only"] is True
assert services["postgres"].get("read_only") is not True

env = services["dashboard"]["environment"]
assert env["APP_ENV"] == "demo" and env["NODE_ENV"] == "production"
if "caddy" in services:
    # A public deployment must issue links and secure cookies for the public
    # origin, not the loopback listener behind the proxy.
    public_domain = caddy["environment"]["TANAGHOM_PUBLIC_DOMAIN"]
    assert public_domain, "caddy requires TANAGHOM_PUBLIC_DOMAIN"
    assert env["APP_BASE_URL"] == f"https://{public_domain}", "public deployment must use its HTTPS origin"
else:
    # The deploy path validates only the workspace profile, so Caddy is absent
    # from this resolved config even on a public host. Accept its HTTPS origin
    # as well as the loopback-only default.
    assert env["APP_BASE_URL"] == "http://127.0.0.1:3210" or env["APP_BASE_URL"].startswith("https://"), \
        "workspace config must use the loopback or public HTTPS origin"
assert env["CREATIVE_STORAGE_BACKEND"] == "s3"
assert env["CREATIVE_STORAGE_S3_ENDPOINT"] == "http://storage:9000"
assert env["CREATIVE_STORAGE_S3_CONDITIONAL_WRITES"] == "verified"
assert env["CREATIVE_STORAGE_S3_ACCESS_KEY_ID_FILE"] == "/run/secrets/s3_access_key"
assert env["CREATIVE_STORAGE_S3_SECRET_ACCESS_KEY_FILE"] == "/run/secrets/s3_secret_key"
assert "CREATIVE_STORAGE_S3_ACCESS_KEY_ID" not in env
assert "CREATIVE_STORAGE_S3_SECRET_ACCESS_KEY" not in env
assert env["AGENCY_WORKSPACE_ENABLED"] in {"true", "false"}, "workspace activation must be explicit"
assert env["GEMINI_API_KEY_FILE"] == "/run/secrets/gemini_api_key"
assert "GEMINI_API_KEY" not in env
assert "AGENCY_WORKSPACE_DATABASE_URL" not in env
assert "AGENCY_WORKSPACE_WORKER_TOKEN" not in env
assert env["CREATIVE_STUDIO_ENABLED"] == "true"
assert env["DESIGN_STUDIO_ENABLED"] == "true"
assert env["MOTION_STUDIO_ENABLED"] == "true"
for flag in [
    "IMAGE_GENERATION_ENABLED", "GENERATIVE_VIDEO_ENABLED", "ML_SEGMENTATION_ENABLED",
    "TALKING_HEAD_ENABLED", "LIP_SYNC_ENABLED", "CUSTOM_AVATAR_ENABLED",
    "AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED", "AGENCY_PILOT_GATEWAY_ENABLED",
    "POSTIZ_AUTOMATION_RUNTIME_READY",
    "POSTIZ_PERFORMANCE_SYNC_ENABLED", "GHL_CONTACT_SYNC_ENABLED",
    "GHL_CONTACT_HANDOFF_ENABLED", "GHL_WEBHOOK_INGRESS_ENABLED",
    "GHL_ACTION_RUNTIME_ENABLED", "GHL_ACTION_RUNTIME_READY", "ALLOW_STAGING_PUBLISH",
]:
    assert env[flag] == "false", f"{flag} must remain disabled"
# POSTIZ_HANDOFF_ENABLED is operator-controlled since the compose file reads it
# from the host .env: the Phase 1 host enables draft handoff. It only queues
# approved drafts, so it must be an explicit boolean and cannot imply publishing.
assert env["POSTIZ_HANDOFF_ENABLED"] in {"true", "false"}, "POSTIZ handoff must be explicit"
assert env["ALLOW_STAGING_PUBLISH"] == "false", "publishing stays disabled"

secrets_dir = Path(os.environ["TANAGHOM_DEMO_SECRETS_DIR"])
assert (secrets_dir / "postgres_password").stat().st_size < 200
assert len((secrets_dir / "api_password").read_text().strip()) == 64
database_url = urlparse((secrets_dir / "database_url").read_text().strip())
assert database_url.scheme == "postgresql"
assert database_url.hostname == "postgres" and database_url.port == 5432
assert database_url.path == "/tanaghom_demo"
assert database_url.username == "tanaghom_api"
assert database_url.password == (secrets_dir / "api_password").read_text().strip()
assert (secrets_dir / "supabase_url").read_text().strip() == "http://auth:43191"
assert (secrets_dir / "supabase_jwks_url").read_text().strip() == "http://auth:43191/auth/v1/.well-known/jwks.json"
assert (secrets_dir / "supabase_url").read_text().strip().find("supabase.co") < 0
users = json.loads((secrets_dir / "auth_users.json").read_text())
# The seed is only used once, when the account store is created. It may be
# emptied after the demo accounts are retired.
assert {item["email"] for item in users["users"]} <= {
    "owner@demo.tanaghom.test", "reviewer@demo.tanaghom.test",
}
assert all(len(item["password"]) >= 16 for item in users["users"])
assert len((secrets_dir / "s3_access_key").read_text().strip()) >= 16
assert len((secrets_dir / "s3_secret_key").read_text().strip()) >= 32
assert (secrets_dir / "auth_private_key.pem").read_text().startswith("-----BEGIN PRIVATE KEY-----")
assert len((secrets_dir / "auth_internal_token").read_text().strip()) == 64
workspace_password = (secrets_dir / "workspace_password").read_text().strip()
assert len(workspace_password) == 64
assert set(workspace_password) <= set("0123456789abcdef")
worker_url = urlparse((secrets_dir / "workspace_database_url").read_text().strip())
assert worker_url.scheme == "postgresql"
assert worker_url.hostname == "postgres" and worker_url.port == 5432
assert worker_url.path == "/tanaghom_demo"
assert worker_url.username == "tanaghom_agency_pilot_worker"
assert worker_url.password == workspace_password
worker_token = (secrets_dir / "workspace_worker_token").read_text().strip()
assert len(worker_token) == 64 and set(worker_token) <= set("0123456789abcdef")
gemini_key = secrets_dir / "gemini_api_key"
assert gemini_key.is_file() and not gemini_key.is_symlink()
assert gemini_key.stat().st_size <= 4096
gemini_value = gemini_key.read_text().strip()
assert gemini_value == "" or (20 <= len(gemini_value) <= 500 and not any(char.isspace() for char in gemini_value))

print("PARSED_DEMO_COMPOSE_BOUNDARIES_PASSED")
