"""Create test-only runtime files once; never copy a production DB/admin credential."""
import base64
import json
import os
from pathlib import Path
import secrets
import sys
from urllib.parse import urlparse
from uuid import UUID

if os.getuid() != 0:
    raise SystemExit('root required')
settings = json.loads(Path(sys.argv[1]).read_text())
expected = {'supabase_url', 'supabase_publishable_key', 'supabase_jwks_url', 'owner_subject', 'owner_email'}
if set(settings) != expected:
    raise SystemExit('unexpected credential/settings fields')
base = urlparse(settings['supabase_url'])
if base.scheme != 'https' or base.username or base.password or not base.hostname.endswith('.supabase.co'):
    raise SystemExit('expected verified Supabase auth endpoint')
if settings['supabase_jwks_url'] != settings['supabase_url'].rstrip('/') + '/auth/v1/.well-known/jwks.json':
    raise SystemExit('unexpected JWKS endpoint')
UUID(settings['owner_subject'])
if '\n' in settings['owner_email'] or '@' not in settings['owner_email']:
    raise SystemExit('invalid owner email')
runtime = Path('/opt/tanaghom-test/runtime')
runtime.mkdir(mode=0o700, exist_ok=False)
directory = runtime / 'secrets'
directory.mkdir(mode=0o700)
api_password = secrets.token_hex(32)
values = {
    'postgres_password': secrets.token_hex(32),
    'api_password': api_password,
    'database_url': f'postgresql://tanaghom_api:{api_password}@postgres:5432/tanaghom_test',
    'supabase_url': settings['supabase_url'],
    'supabase_publishable_key': settings['supabase_publishable_key'],
    'supabase_jwks_url': settings['supabase_jwks_url'],
    'integration_credential_key': base64.b64encode(secrets.token_bytes(32)).decode(),
    'integration_worker_token': secrets.token_hex(32),
}
for name, value in values.items():
    path = directory / name
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(value + '\n')
    os.chown(path, 0, 1000)
    os.chmod(path, 0o644 if name in ['postgres_password', 'api_password'] else 0o640)
owner = runtime / 'owner.json'
fd = os.open(owner, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    json.dump({k: settings[k] for k in ['owner_subject', 'owner_email']}, stream)
print('Fresh test secrets created; no values logged.')
