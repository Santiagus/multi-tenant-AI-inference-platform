# M03 — Async Inference

Depends on: M02 | Read: `.agents/skills/async-workloads/SKILL.md`, `.agents/skills/typescript-fastify/SKILL.md`, `.agents/skills/postgresql/SKILL.md`

## Objective

Implement a reliable asynchronous job lifecycle.

## Deliverables

- POST job;
- queued/running/succeeded/failed/cancelled states;
- worker;
- retries with bounded backoff;
- idempotency;
- DLQ;
- cancellation semantics;
- artifact persistence;
- failure recovery tests.

## Acceptance criteria

Duplicate submission cannot create unintended duplicate work. Worker failure and retry behavior are tested. Job state remains consistent.

## Out of scope

Kubernetes scaling, external provider routing.

## Outcome

_Pending._
