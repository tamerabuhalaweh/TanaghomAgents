"""Validate actual Compose JSON before creating any test service."""
import json
import sys

config = json.load(sys.stdin)
services = config['services']
assert set(services) == {'postgres', 'dashboard', 'caddy'}, 'unexpected services'
for name, size in [('dashboard', '64m'), ('caddy', '32m')]:
    assert services[name]['tmpfs'] == [f'/tmp:size={size},mode=1777'], (
        f'{name}: tmpfs must be one complete absolute mount, including its comma options'
    )
for name in ['postgres', 'dashboard']:
    assert not services[name].get('ports'), f'{name}: public port not permitted'
assert config['networks']['database']['internal'] is True
print('PARSED_TEST_COMPOSE_BOUNDARIES_PASSED')
