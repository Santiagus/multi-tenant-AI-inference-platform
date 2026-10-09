# M08 — Provider Routing

Depends on: M04, M05 | Read: `.agents/skills/python-inference/SKILL.md` (if applicable), `.agents/skills/observability/SKILL.md`

## Objective

Route workloads between local and external inference providers using measurable constraints.

## Deliverables

- provider adapters: local, RunPod, Bedrock, SageMaker (mocks where credentials/cost make live testing inappropriate);
- deterministic routing policy over: workload/model requirements, VRAM/capacity, queue depth, latency SLO, provider availability, tenant policy, estimated cost, target gross margin.

## Acceptance criteria

Routing decisions are observable and explainable, e.g.
`local queue high + SLO risk + provider available + margin acceptable → external GPU provider`.

## Out of scope

ML-based routing. Deterministic policy first.

## Outcome

_Pending._
