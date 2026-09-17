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

   `CODEX_AUTH_JSON` is optional and covered in step 5.

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

## 5. Optional: images from your ChatGPT subscription

By default images cost OpenAI API credit. The worker can instead render them
with the vendored `image-use` CLI (`web/vendor/image-use/`) against your own
ChatGPT subscription, which costs nothing per image beyond the plan you already
pay for.

It runs a local process, so it works **only where that process can run** — the
Actions worker, never the Vercel function. Neither choice is global:

- **AI studio** has a *Generate images with* dropdown: **API** generates inline
  in the request, billed per image and back in seconds; **Codex** queues an
  `IMAGE_GENERATE` job the worker runs, so it costs nothing per image and lands
  in the Media Library about a minute later (step 6 makes that a minute rather
  than up to five).
- **An Image generator step** has the same choice plus mock, under *Generate
  with*: `default` follows the deployment, `mock` is a free placeholder for
  testing the graph, `api` bills per image, `codex` uses the subscription.
- `AI_IMAGE_PROVIDER` sets what those controls **start on**, nothing more.
  Setting it to `image-use` on Vercel too makes Codex the default in the studio;
  leaving it unset there keeps the API as the default and Codex one click away.

### When the credential goes stale

It never falls back to the paid API. That is deliberate: a silent downgrade
turns an expired secret into an OpenAI bill you find out about on an invoice.
Instead image generation **pauses** and says so:

- The job fails with what happened, that **nothing was charged to the OpenAI
  API**, and how to fix it. The studio shows that text on the job.
- Whoever asked for the image gets a notification, the same kind an expired
  social connection raises.
- The worker's log opens with `IMAGE GENERATION PAUSED`.
- Everything else in that run is unaffected — due posts still publish, video
  still renders.

To get generating again, on a machine where you can sign in:

```bash
codex login                       # refreshes ~/.codex/auth.json
pbcopy < ~/.codex/auth.json       # macOS; the whole file, braces included
```

Then paste it into **Settings → Secrets and variables → Actions →
`CODEX_AUTH_JSON`** (Update secret). That is the whole job — the next run
notices the secret changed and takes it over the copy in the bucket, which is
otherwise preferred because it is the one the CLI keeps refreshed.

If you would rather pay per image for now, switch the studio dropdown or the
step's *Generate with* to **API**. That is an explicit choice, which is the
only way this path ever spends API credit.

`npm run doctor` reports the credential's state — whether it is present, and
how long since it was last refreshed.

Keep `OPENAI_API_KEY` set on Vercel either way — it is what the API option uses.

### A true 9:16, only here

Codex is the only source that renders **Vertical 9:16 · 1024×1820**. The OpenAI
API offers 2:3, 3:2 and 1:1 and nothing else, so a vertical video frame has to
be cropped out of a 2:3 image and loses about 16% of its width. A 9:16 image
loses nothing. The size dropdown offers it only while the step or the studio is
set to Codex, and switching back to API resets the shape rather than saving one
the API will refuse.

To turn it on:

1. On a machine where you can sign in, once ever:

   ```bash
   npm i -g @openai/codex
   codex login
   ```

2. Copy the **entire contents** of `~/.codex/auth.json` into a repo secret named
   `CODEX_AUTH_JSON` (Settings → Secrets and variables → Actions). That file
   holds a live OAuth access and refresh token for your ChatGPT account: treat
   it exactly like a password, and run `codex login` again to rotate it if it
   ever leaks.

3. Set `AI_IMAGE_PROVIDER=image-use` in the Vercel project's environment so the
   studio queues instead of billing the API, and redeploy.

The worker restores that credential at the start of every run and writes it
back to `system/codex-auth.enc` in your media bucket, encrypted with
`TOKEN_ENCRYPTION_KEY`. That write-back is what keeps it working: the CLI
refreshes the OAuth token as it expires, and a throwaway runner would otherwise
lose the refreshed copy and eventually stop authenticating.

Two things that will bite:

- **`IMAGE_USE_MODEL` is pinned to `gpt-5.5` in `worker.yml`.** The CLI's own
  default driver model is refused with *"requires a newer version of Codex"*
  unless the caller reports a very recent codex CLI, and a runner with no codex
  installed reports the script's floor. Measured, not guessed.
- **Requested sizes are a hint, not a contract.** The subscription backend
  normalises them — asking for 1024×1024 has come back 1254×1254. The aspect
  ratio holds; the pixel count does not. Asset rows record what actually came
  back, not what was asked for.

If generation starts failing, the error text on the job says why. `python3
vendor/image-use/image-use doctor` on any machine explains the rest.

## 6. Optional: make it feel instant

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
