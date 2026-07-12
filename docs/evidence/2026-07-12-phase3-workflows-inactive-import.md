# Phase 3 workflows — inactive import evidence

## Result

PR #27 merged as commit
`dbdc5574b1a03db810342719a4af1179e0a9b71c`. The exact generated Campaign
Strategist and Content Producer workflow exports from that commit were imported
into the GPU-server n8n instance with activation explicitly disabled.

No credential was created, no workflow was activated, no live job or campaign
was created, and neither live Gemma nor an external integration was called.

## Disposable execution evidence

GitHub Actions run `29204888734` used the pinned production n8n image
`2.26.8@sha256:0afb71a39e51637b4d5b4010d90e68bc502d3ca1d2a4d953eb5fcd7d86330ccd`,
disposable PostgreSQL, a test-only LOGIN worker role, and a simulated Gemma API.
The exact exports executed successfully and proved:

- Strategist claimed only `campaign.strategy.generate`, called simulated Gemma,
  and persisted a versioned strategy through migration `0005`;
- Content Producer claimed only `campaign.content.generate`, created exactly one
  pending-approval draft, and left its job at `waiting_approval`;
- malformed Gemma output did not persist business output and recorded a bounded
  retry through `record_agent_job_failure`; and
- prompt regeneration produced no Git diff on Linux after platform-independent
  line-ending normalization.

## GPU-server import evidence

| Workflow ID | Name | Nodes | Active |
| --- | --- | ---: | --- |
| `phase3StrategistV1` | Tanaghom — Campaign Strategist v1 | 9 | false |
| `phase3ContentProducerV1` | Tanaghom — Content Producer v1 | 9 | false |

The n8n execution table contained zero executions for both IDs after import.
All five n8n containers and all nine protected host services remained healthy.

The post-import n8n audit reported expected generic warnings for the reviewed
Code/HTTP nodes and for constant controlled-function SQL calls that do not use
n8n's optional Query Parameters UI field. The SQL text is static and constrained
to migration `0005` functions; dynamic values use the Postgres node's query
replacement binding. No webhook, Execute Command, filesystem, or SSH node is
present.

## Rollback

```bash
docker exec smartlabs-n8n-n8n-1 n8n delete:workflow --id=phase3StrategistV1
docker exec smartlabs-n8n-n8n-1 n8n delete:workflow --id=phase3ContentProducerV1
```

Rollback deletes only these two inactive workflow records. It does not touch
credentials, executions, n8n infrastructure, database migrations, or protected
services.
