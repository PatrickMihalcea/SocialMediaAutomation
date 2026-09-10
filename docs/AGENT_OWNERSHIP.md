# Agent ownership

Workspace root: `/Users/mihalceap/Documents/Projects/SocialMediaAutomation`. App: `web/`. Branch: `v2.0/web-app-build` (single worktree; isolated file ownership instead of competing worktrees because `web/` is untracked in the parent repo).

| Agent | Responsibility | Owns | Must not edit | Status |
|---|---|---|---|---|
| Orchestrator | Contracts, schema, queue map, docs, integration | `prisma/`, `docs/`, `src/lib/queue/types.ts`, `src/lib/queue/handlers.ts` | — | active |
| Composer | Platform-specific composer, edit/duplicate | `src/components/composer-*.tsx`, `src/app/w/[slug]/compose/**`, `src/app/actions/posts.ts`, `src/lib/posts/**` | prisma schema | in progress |
| Scheduler | Calendar, smart queue, recurrence, bulk | `src/app/w/[slug]/calendar/**`, `src/app/w/[slug]/queue/**`, `src/app/actions/queue.ts`, `src/app/actions/recurrence.ts`, `src/components/calendar-*.tsx`, `src/components/queue-*.tsx`, `src/lib/scheduling/**` | prisma schema | pending |
| Media | Folders, tags, bulk, editor | `src/app/w/[slug]/media/**`, `src/app/actions/media.ts`, `src/lib/media/**`, `src/components/media-*.tsx` | prisma schema | pending |
| AI | Chat, image/video/audio jobs, tools | `src/lib/ai/**`, `src/app/actions/ai.ts`, `src/app/w/[slug]/assistant/**`, `src/app/w/[slug]/studio/**`, `src/app/api/workspaces/[slug]/ai/**`, `src/components/ai-*.tsx` | prisma schema, queue types | pending |
| Product ops | Analytics, team, campaigns, billing, admin, search, notifications | `src/lib/analytics/**`, `src/lib/billing/**`, `src/lib/notifications/**`, `src/app/admin/**`, `src/app/invite/**`, `src/app/pricing/**`, `src/app/api/webhooks/**`, `src/app/api/cron/**`, `src/app/w/[slug]/{analytics,team,campaigns,search,notifications,settings/billing}/**`, `src/app/actions/{team,campaigns,billing,notifications,admin,analytics}.ts` | prisma schema, queue types | pending |
| QA | Tests, E2E, report | `src/**/*.test.ts`, `e2e/`, `docs/FINAL_IMPLEMENTATION_REPORT.md`, `README.md` | feature business logic unless fixing tests | pending |

Interface changes require orchestrator approval.
