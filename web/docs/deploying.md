# Deploying to a permanent URL

One URL that never changes again. No tunnel, no laptop, no card.

| Piece | Where | Why there |
|---|---|---|
| Web app | Vercel | Node runtime, so `sharp` and the rest run unchanged |
| Database | Neon | Free Postgres, no card |
| Media | Cloudflare R2 | Already set up and working |
| Worker (ffmpeg, librosa, all jobs) | GitHub Actions | Nothing stays running, so nothing accrues |

The web app **enqueues** jobs and never runs them: `QUEUE_IN_WEB_SERVER`
defaults to false, so a serverless function never tries to render a video. The
worker drains the `jobs` table every five minutes. That split is what makes this
deployable at all.

## Why not Cloudflare Workers

Workers is a different JavaScript runtime, not a Node host, and three things
here cannot run on it:

- **`sharp`** — a native C++ binary (upload thumbnails, video poster frames, the
  media library's rotate/crop). Native binaries do not run on Workers at all.
  Reached from `src/app/actions/media.ts`, which is a web request path.
- **`child_process`** — five modules shell out to ffmpeg and Python.
- **`node:fs`** — `src/lib/storage/index.ts` imports `LocalStorage`
  unconditionally, so every storage caller pulls it in even under `s3`.

Moving there means replacing sharp with WASM or Cloudflare Images, pushing all
image work into the worker (the editor stops being instant), untangling the
storage module graph, and putting Prisma on driver adapters. Worth knowing; not
worth doing to reach a first deployment.

## 1. Database

1. **neon.tech** → new project → copy the **pooled** connection string.
2. Apply the schema from your machine, once:
   ```sh
   cd web
   DATABASE_URL="<neon url>" npx prisma migrate deploy
   ```
   The worker also runs `migrate deploy` on every tick, so later migrations
   apply themselves; this first one just gets the app bootable.

## 2. Vercel

1. **vercel.com** → Add New → Project → import the repo.
2. **Root Directory: `web`.** The Next app is not at the repo root; this is the
   single most common way this deploy fails.
3. Set the production branch to whichever branch you are deploying.
4. Add the variables in the table below, then deploy.
5. The first deploy gives you `https://<project>.vercel.app`. That hostname is
   permanent.
6. Set `APP_URL` and `NEXT_PUBLIC_APP_URL` to it and **redeploy** —
   `NEXT_PUBLIC_*` is inlined at build time, so it only takes effect on a build
   that runs after it is set.

### Vercel environment variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled URL |
| `AUTH_SECRET` | same as local |
| `TOKEN_ENCRYPTION_KEY` | **must** match local, or connected accounts stop decrypting |
| `APP_URL` | `https://<project>.vercel.app` |
| `NEXT_PUBLIC_APP_URL` | same |
| `MOCK_MODE` | `false` |
| `STORAGE_DRIVER` | `s3` |
| `AI_PROVIDER` | `openai` |
| `RENDER_DRIVER` | `none` — there is no ffmpeg on Vercel, and the web app never renders |
| `AUDIO_ANALYZER` | leave unset, same reason |
| `CRON_SECRET` | any long random string |
| `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL` | same as local |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | same as local |
| `S3_PUBLIC_BASE_URL` | leave **empty** — presigned URLs keep the bucket private |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_PRIVACY_STATUS` | same as local |
| `META_APP_ID`, `META_APP_SECRET` | same as local |
| `GITHUB_DISPATCH_TOKEN`, `GITHUB_DISPATCH_REPO` | optional; see step 5 |

Do not set `REDIS_URL`, `PYTHON_BIN`, or `QUEUE_IN_WEB_SERVER`.

## 3. OAuth redirect URIs — once, permanently

This is the step the tunnel made you redo constantly. With a fixed hostname it
is done once.

- **Google Cloud Console** → Credentials → your OAuth client → Authorised
  redirect URIs → `https://<project>.vercel.app/api/oauth/youtube/callback`
- **Meta** → your app → Facebook Login → Settings → Valid OAuth Redirect URIs →
  `https://<project>.vercel.app/api/oauth/instagram/callback`

Keep the `localhost:3000` entries alongside them so local development still
works.

## 4. The worker

1. Repo → **Settings → Secrets and variables → Actions** → add one secret per
   `secrets.*` in `.github/workflows/worker.yml`:

   `APP_URL` `AUTH_SECRET` `DATABASE_URL` `META_APP_ID` `META_APP_SECRET`
   `OPENAI_API_KEY` `OPENAI_IMAGE_MODEL` `OPENAI_TEXT_MODEL` `S3_ACCESS_KEY_ID`
   `S3_BUCKET` `S3_ENDPOINT` `S3_PUBLIC_BASE_URL` `S3_REGION`
   `S3_SECRET_ACCESS_KEY` `TOKEN_ENCRYPTION_KEY` `YOUTUBE_CLIENT_ID`
   `YOUTUBE_CLIENT_SECRET` `YOUTUBE_PRIVACY_STATUS`

   `DATABASE_URL` and `APP_URL` are the **Neon** and **Vercel** values, not the
   local ones.

2. **Merge to the default branch.** GitHub only runs scheduled workflows from
   the default branch. While the work sits on a feature branch the five-minute
   tick never fires.

3. Test without waiting: **Actions → Scheduled worker → Run workflow**.
   `[run-once] done — claimed N job(s)` means it is wired correctly.

Two schedules run from that one file: every five minutes for due posts and
workflows, and every six hours with `RUN_ONCE_COARSE=1` for recurrence
expansion and analytics refresh.

## 5. Optional: make it feel instant

Without this, confirming "run this workflow" can sit up to five minutes before
anything happens. With it, the app asks GitHub to start a run immediately.

See **Making it feel instant** in `going-live.md`. Every failure path is caught
and logged, so a missing or expired token costs you the five-minute wait and
nothing else.

## Carrying your existing data over

Neon starts empty. Your workspace, workflows and connected accounts live in
local Postgres. R2 media is already remote, so the asset rows keep resolving.

```sh
pg_dump --no-owner --no-acl bridge88 > /tmp/bridge88.sql
psql "<neon url>" < /tmp/bridge88.sql
```

Connected accounts survive only if `TOKEN_ENCRYPTION_KEY` is identical in
Vercel and in the GitHub secrets. Different key, and every stored OAuth token
becomes undecryptable.

## What this does not promise

- **Unattended timing is soft.** Scheduled work rides the five-minute poll, and
  GitHub does not guarantee the tick is punctual.
- **A quiet repo pauses its own schedule.** GitHub disables scheduled workflows
  after a stretch of no activity. Commit occasionally, or check the Actions tab.
- **Vercel's Hobby plan excludes commercial use.** Fine while you are the only
  user. Once this has paying customers it is a paid plan, or a different Node
  host — not a technical problem, a licensing one.
