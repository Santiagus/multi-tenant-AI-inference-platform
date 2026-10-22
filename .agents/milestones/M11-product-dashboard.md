# M11 — Product Dashboard

Depends on: M08 | Read: `.agents/skills/react/SKILL.md`, `.agents/skills/react-flow/SKILL.md`

## Objective

Expose the platform as a coherent product, not only infrastructure.

## Deliverables

- jobs view;
- provider/model view;
- routing decision explanation;
- usage, cost, revenue, gross profit/margin;
- workload path visualization (React Flow) where useful.

Grafana remains the operations dashboard; React owns product and economic views.

## Acceptance criteria

A user can submit or inspect a job and understand where it ran, why it was routed there, its latency and estimated economics.

## Out of scope

Duplicating Grafana operational dashboards.

## Outcome

- Entry points: `pnpm --filter @platform/dashboard dev` (Vite port 5173), `pnpm --filter @platform/dashboard build`, and `GET /v1/jobs`, `GET /v1/analytics/economics`.
- Product dashboard: Implemented React + TypeScript + Vite app in `apps/dashboard/` with dark mode UI, auto-polling, and real-time state.
- Views delivered: Jobs & DLQ inspection, Provider & Model catalog with live health toggles, Deterministic Routing 5-stage explainability simulator, and FinOps Usage & Gross Margin economics.
- React Flow visualization: Built interactive Two-Path lifecycle diagram in `WorkloadPathView` highlighting Path A (SQS+KEDA) vs Path B (Flyte+Kueue) with protocol and telemetry side-panels.
- Test coverage: 12 dashboard unit tests (`api-client.test.ts`, `economics-calculations.test.ts`) and 2 API integration tests in `analytics-routes.test.ts`. Total 106 TypeScript tests passed.
- Deviations from spec: None.
- Stubs left: Live production readiness benchmark reporting in dashboard deferred to M12.
