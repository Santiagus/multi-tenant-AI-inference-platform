---
name: observability
description: OpenTelemetry tracing, Prometheus metrics, Grafana dashboards and correlation IDs across the job path.
---

# Observability

- OpenTelemetry for traces and standardized application telemetry.
- Every async job retains identifiers to correlate request → job → queue → worker → inference → artifact.
- Prometheus for operational metrics; Grafana for operational visualization.
