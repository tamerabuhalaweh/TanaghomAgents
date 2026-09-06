# Agency evaluation: selected CPU VPS read-only inventory

Date: 2026-09-06. Owner: #177. This is a sanitized transcription of a single
read-only SSH inventory, not continuous monitoring or deployment acceptance.

## Direction and scope

Tamer supplied a local connection note and selected VPS `155.117.45.45` for
CPU test services, with existing shared Gemma 4 providing inference. This
supersedes the separate-GPU proposal in the first version of PR #199. It does
not authorize changing the shared model, deploying this test stack or sending
new schema/model requests. No second GPU or infrastructure spend is requested.

SSH connected as `administrator`, verifying the existing local known-host key
and rejecting unknown keys. No host-key bypass or sudo was used. The supplied
password was passed to a local SSH helper in memory, never in command arguments,
commits or report output. No credential value is included here. The helper's
dependency was installed only in an ignored local disposable virtual environment;
no software or files were installed on the VPS.

## Observed inventory

| Check | Observation |
| --- | --- |
| Host | `vps-khal-tanaghom`, `155.117.45.45` |
| Kernel | Linux `6.8.0-137-generic` |
| Online CPUs | 3 |
| RAM | 5,925 MiB total; 3,307 MiB available at observation |
| Swap | 2,047 MiB total; 1,162 MiB occupied; this alone does not establish active swapping |
| Root disk | `/dev/vda3`: 103G total, 59G used, 40G available, 60% used (`df -h`) |
| Docker server | `29.6.2` |
| Running/restarting containers | 21, including Hybrid, Postiz, identity, Temporal and other workloads |
| Existing abnormal container states | Two restarting, two unhealthy; listed below |

Observed, not diagnosed or changed:

- `tanaghom-zitadel-dev-zitadel-api-1`: restarting.
- `tanaghom-zitadel-dev-postgres-1`: restarting.
- `tanaghom-openbao-dev`: unhealthy.
- `temporal`: unhealthy.

These states preceded any proposed Tanaghom test deployment. Their owners
should assess them; this task must not repair, stop or reconfigure them.
Neither these states nor a one-time resource snapshot proves that the VPS
cannot support a small test, or that it safely supports the whole runner.

Listening TCP inventory included public/wildcard 22, 80, 443, 8080 and 8443,
and loopback 4007, 7233, 8081, 18200 and 18210, plus local DNS. This is an
inventory, not a port reservation or permission to expose a test service.
Container CPU/memory metadata was also read once; it is not a peak-load study.

All commands completed with exit code 0:

```sh
hostname
uname -sr
id -un
getconf _NPROCESSORS_ONLN
free -m
df -h /
docker version --format '{{.Server.Version}}'
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
ss -ltnH
```

## Decision and limitations

Proceed with **source preparation**, not startup. Design a separately reviewed
resource-capped, disposable CPU test package with aggregate host headroom,
run-owned storage and cleanup, fixed authenticated Gemma egress and no public
ingress. Do not copy the CI runner's host networking/disabled SSRF settings to
this co-hosted server. Refresh available capacity immediately before any
authorized startup; do not reuse today's numbers as a permanent budget.

CPU test state must not reuse the existing Hybrid/Postiz database, credentials,
volumes or networks. The CPU host is not the certified `38.247.187.232`
TanaghomAgents runtime. Its inventory does not update production/provider UAT
status or certify shared Gemma identity, health, schema compatibility or capacity.

No remote workload/configuration change, image pull, container creation,
restart, file write, log/environment read, firewall change, provider/API call
or connection to the GPU host was performed. No cleanup is required remotely
because no test resources were created. Existing unrelated workloads remain
outside this project's repair scope.

See [selected setup and remaining gates](../planning/agency-expansion/REVIEW_AND_MODEL_SETUP.md).
Production-release evidence remains **60/100** under the existing scorecard.
