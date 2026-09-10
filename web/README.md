# Bridge88 web application

Production-oriented social publishing SaaS built with Next.js, TypeScript, Prisma, PostgreSQL, Redis/BullMQ and the Bridge88 design system.

## Local development

```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

The seed account is `demo@bridge88.local` / `demo-password`.

PostgreSQL is required. Redis is optional while `QUEUE_DRIVER=in-process`; use `QUEUE_DRIVER=bullmq` and run `npm run worker:prod` for the production transport.

## External integration modes

The default `.env` runs without third-party credentials:

- social accounts use the same adapter interface and validation as production, served by `MockAdapter`
- AI uses deterministic, structured mock output
- media uses HMAC-signed local storage URLs
- billing defaults to the Free-plan limit service

Switch boundaries independently:

- `AI_PROVIDER=openai` plus `OPENAI_API_KEY`
- `STORAGE_DRIVER=s3` plus the `S3_*` / Cloudflare R2 variables
- `QUEUE_DRIVER=bullmq` plus `REDIS_URL`
- add platform OAuth credentials listed in `.env.example`

Official social APIs often need review beyond credentials:

- Meta: `instagram_content_publish`, `pages_manage_posts`, related read scopes and App Review
- LinkedIn: Community Management API access for organization posting
- X: a paid API tier with write access
- TikTok: Content Posting API audit for public publishing
- YouTube: Google API audit for public uploads beyond unverified quota

No integration scrapes or automates a browser.

## Publishing reliability

`src/lib/publishing/engine.ts` owns scheduling state, retries and idempotency. It calls only `SocialPlatformAdapter`; platform details remain in independent adapters.

Each logical post creates one `PostPlatform` per target account. Its stable idempotency key survives retries. Workers conditionally claim rows, check a previously returned platform post ID before re-sending, retry transient failures with exponential backoff, and stop permanent failures with an actionable message.

For Vercel, configure `CRON_SECRET`; `vercel.json` invokes `/api/cron/publish` every minute. At larger scale use BullMQ and run the worker as a separate long-lived service.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Secrets never use `NEXT_PUBLIC_*`. OAuth tokens are encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`.
