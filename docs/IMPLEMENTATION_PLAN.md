# Implementation plan

Lead: orchestrator on `v2.0/web-app-build`. Product code lives in `web/`.

## Audit (2026-09-10)

Exists and works: Auth.js, workspaces/onboarding, encrypted OAuth connect/callback, publishing engine with idempotency, BullMQ/in-process queue, Prisma schema, seed, mock social/AI adapters, plan-limit enforcement, dashboard/list calendar, basic media upload, AI JSON tools, admin counts.

Incomplete: platform-specific composer UI (compose page currently imports a missing form), calendar month/week, smart queue UI, recurrence UI, media folders/editor, AI chat/image/video/audio studios, Stripe checkout, invite accept, analytics charts/post detail, admin ops, tests/E2E.

Architecture is preserved. New work extends existing interfaces rather than replacing them.

## Shared contracts (locked)

- `SocialPlatformAdapter` — `web/src/lib/social/types.ts`
- `AiProvider` — `web/src/lib/ai/types.ts` (text + image). Video/audio providers live beside it and must not leak vendor types into UI.
- Storage — `web/src/lib/storage/types.ts`
- Publishing — `web/src/lib/publishing/engine.ts`
- Jobs — `web/src/lib/queue/types.ts`
- Errors — `web/src/lib/errors.ts`
- AuthZ — `web/src/lib/auth/rbac.ts` + `guard.ts`

## Workstreams

| ID | Workstream | Status | Dependencies |
|---|---|---|---|
| A1 | Core schema / types | complete | — |
| A2 | Auth / RBAC / workspaces | complete | A1 |
| A3 | Frontend foundation | complete | A1 |
| A10 | Social core + OAuth | complete | A1 A2 |
| A11 | Platform adapters | complete (mock + official boundaries) | A10 |
| A13 | Publishing engine | complete | A10 |
| P4 | Composer / post lifecycle | in progress | A10 A13 |
| P5 | Calendar / queue / recurrence | pending | P4 |
| P6 | Media library / editor | pending | A3 |
| P7 | AI text/chat/image/video/audio | pending | P6 A1 |
| P8 | Analytics / notifications | pending | A13 |
| P9 | Team / campaigns / search | pending | A2 |
| P10 | Billing | pending | A1 A2 |
| P11 | Admin / health | pending | A13 P10 |
| P12 | QA / docs / E2E | pending | all |

## Merge / verification

After each workstream: `prisma generate`, `npm run typecheck`, `npm run lint`, `npm test`. Full E2E and production build at P12.
