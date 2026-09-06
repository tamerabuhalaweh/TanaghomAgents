"""One-time test-runtime additions; never read another project's credentials."""
import os
from pathlib import Path
import secrets

assert os.getuid() == 0
directory=Path('/opt/tanaghom-test/runtime/secrets')
assert directory.is_dir()
password=secrets.token_hex(32)
values={'workspace_worker_password':password,
 'workspace_database_url':f'postgresql://tanaghom_agency_pilot_worker:{password}@postgres:5432/tanaghom_test',
 'workspace_worker_token':secrets.token_hex(32),'workspace_n8n_key':secrets.token_hex(32),
 # Empty until Tamer provides the Gemma credential; no false runtime readiness.
 'gemma_api_key':''}
if any((directory/name).exists() for name in values):
 raise SystemExit('Workspace secret files already exist; refuse partial replacement')
for name,value in values.items():
 fd=os.open(directory/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(value+'\n' if value else '')
 os.chown(directory/name,0,1000)
 os.chmod(directory/name,0o644 if name=='workspace_worker_password' else 0o640)
print('Workspace secret files created; Gemma key intentionally absent')
