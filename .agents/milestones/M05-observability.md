# M05 — Observability

Depends on: M04 | Read: `.agents/skills/observability/SKILL.md`

## Objective

Make the complete job path observable.

## Deliverables

- traces: API → authorization → queue → worker → inference → artifact;
- metrics: request rate, queue depth, queue wait, inference latency (P50/P95/P99), errors/retries, throughput, worker utilization, GPU metrics when available;
- Grafana dashboards for operational debugging.

## Acceptance criteria

A single job can be followed across components using correlation/request/job identifiers.

## Out of scope

Full production alerting, enterprise SIEM.

## Outcome

_Pending._
