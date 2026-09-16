# Connecting real accounts

How to run Bridge88 locally against OpenAI, a real YouTube channel and a real
Instagram account. Everything here stays on your machine; nothing is deployed.

Run `npm run doctor` after each step. It makes real calls rather than checking
that a variable is non-empty, so it catches a revoked key or an unreachable
origin before either costs you a paid generation or a half-published post.

## Before you start

Put every secret in `web/.env`. Nothing in this repo should ever hold one, and a
key pasted into a chat window, a ticket or a commit should be treated as burned
and rotated. `.env` is gitignored — check that it still is.

Use accounts you own. Instagram publishing posts to a real profile that real
people can see, and YouTube uploads a **public** video by default (see the note
at the end if you want private uploads while testing).

---

## 1. OpenAI

The only step with no console setup.

1. Create a key at <https://platform.openai.com/api-keys>.
2. In `.env`:
   ```
   AI_PROVIDER="openai"
   OPENAI_API_KEY="sk-..."
   OPENAI_TEXT_MODEL="gpt-4o-mini"
   OPENAI_IMAGE_MODEL="gpt-image-1"
   ```
3. Restart the worker and the server: `npm run serve:stop && npm run serve && npm run worker:bg`

`gpt-image-1` needs a **verified organisation** — Settings → Organization →
General → Verify. Without it the key works for text and fails only when an image
step runs, several minutes into a workflow. `npm run doctor` checks for the model
in your account and says so up front.

Cost: the bedroom workflow generates eight images per run. At `gpt-image-1`
1024×1536 that is roughly a few cents an image, so budget accordingly before
scheduling anything hourly.

---

## 2. YouTube

Works entirely from localhost — the adapter uploads the bytes to Google rather
than asking Google to fetch them.

1. Create a project at <https://console.cloud.google.com/>.
2. **APIs & Services → Library** → enable **YouTube Data API v3**. Enable
   **YouTube Analytics API** too if you want per-video metrics.
3. **OAuth consent screen**:
   - User type **External**, publishing status **Testing**.
   - Add these scopes: `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`,
     `yt-analytics.readonly`.
   - Under **Test users**, add the Google account that owns the channel. In
     Testing mode only listed test users can authorise, and refresh tokens
     expire after **7 days** — expect to reconnect during a long test.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorised redirect URI, exactly:
   ```
   http://localhost:3000/api/oauth/youtube/callback
   ```
   Google permits plain `http` for `localhost` only.
5. In `.env`:
   ```
   YOUTUBE_CLIENT_ID="....apps.googleusercontent.com"
   YOUTUBE_CLIENT_SECRET="..."
   ```
6. Restart, then **Social accounts → Connect → YouTube**.

**Quota.** A new project gets 10,000 units/day and an upload costs **1,600** — so
six uploads a day, then everything fails until midnight Pacific. Unaudited
projects may also find uploads forced to private regardless of the requested
privacy. Both are Google's limits, not the app's.

---

## 3. Instagram

The one that needs more than a key, for a reason worth understanding:

> **Instagram publishes by fetching the video from a URL you give it.** The
> Graph API takes a `video_url`, downloads it on Meta's servers, transcodes it,
> and only then publishes. That URL has to be reachable from the public
> internet. `http://localhost:3000` is not.

YouTube does not have this problem because it accepts an upload.

So there are two separate public-reachability needs, and conflating them is what
makes this look harder than it is:

| What | Needs to be public | For how long |
|---|---|---|
| The **media** Instagram downloads | yes, always | every publish, forever |
| The **OAuth callback** the browser lands on | yes | the few seconds of connecting an account |

### 3a. Move storage to a bucket

Do this first. It solves the media half permanently, it is what you need in
production anyway, and it means **a locally-running app can publish real media
without exposing itself to the internet at all.**

Cloudflare R2 is the cheapest fit (no egress charges, S3-compatible, generous
free tier). Any S3-compatible bucket works.

1. Cloudflare dashboard → **R2** → create a bucket.
2. **Manage R2 API Tokens** → create a token with **Object Read & Write** scoped
   to that bucket. Copy the Access Key ID, Secret Access Key, and the S3 API
   endpoint (`https://<account-id>.r2.cloudflarestorage.com`).
3. In `.env`:
   ```
   STORAGE_DRIVER="s3"
   S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
   S3_REGION="auto"
   S3_BUCKET="bridge88-media"
   S3_ACCESS_KEY_ID="..."
   S3_SECRET_ACCESS_KEY="..."
   S3_PUBLIC_BASE_URL=""
   ```
4. Restart, then `npm run doctor`. **Media reachable** mints the exact URL the
   publisher would hand to Instagram and fetches it.

Leave `S3_PUBLIC_BASE_URL` empty and the app hands out **presigned** URLs: the
bucket stays private, and each link expires. That is the safer default and it is
enough for Instagram. Set it later to a public r2.dev or CDN hostname only if you
want media served without a signature — faster, cached, but permanently readable
by anyone with the key.

Existing media stays on local disk. Either re-upload what you need, or accept
that old assets stop resolving.

### 3b. What the account has to be

Instagram's publishing API does not work on a personal account. You need three
things, and the Connect flow fails with *"No Instagram Business account was
found"* if any is missing:

1. **An Instagram Business or Creator account.** In the Instagram app:
   Settings and privacy → Account type and tools → Switch to professional
   account. Free, reversible, and it does not change your handle or posts.
2. **A Facebook Page, linked to it.** Business accounts must be connected to a
   Page. In the Instagram app: Settings → Account type and tools → Sharing to
   other apps → Facebook, or from the Page's own Meta Business Suite settings.
   Create a throwaway Page if you do not have one — it does not need followers.
3. **The Facebook account you log in with must be an admin of that Page**, and
   hold a role on the Meta app from 3d.

To check: open <https://business.facebook.com/settings/instagram-accounts>. If
your Instagram account is listed with a connected Page, you are ready.

### 3c. Expose the callback while you connect

`ngrok` is already installed here.

```bash
ngrok http 3000
```

Copy the `https://....ngrok-free.app` forwarding URL, and in `.env`:

```
APP_URL="https://....ngrok-free.app"
```

Set `APP_URL`, **not** `NEXT_PUBLIC_APP_URL`. Next inlines `NEXT_PUBLIC_*` into
the bundle when it builds, so changing that one and restarting does nothing —
the callback keeps saying localhost. `APP_URL` is read at runtime.

Restart, connect the account in the UI, then you can stop the tunnel and remove
`APP_URL` again. The stored token keeps working, and publishing pulls media from
the bucket rather than from you.

### 3d. The Meta app

1. Create an app at <https://developers.facebook.com/apps/> — type **Business**.
2. Add the products **Facebook Login** and **Instagram Graph API**.
3. **Facebook Login → Settings → Valid OAuth Redirect URIs**:
   ```
   https://....ngrok-free.app/api/oauth/instagram/callback
   ```
   This has to match `APP_URL` exactly, so update it whenever the tunnel changes.
4. **App roles → Roles**: add yourself as an admin or developer.
5. **Settings → Basic** — copy the App ID and App Secret into `.env`:
   ```
   META_APP_ID="..."
   META_APP_SECRET="..."
   ```
6. Restart, then **Social accounts → Connect → Instagram**.

**App Review.** Publishing needs `instagram_content_publish`, plus
`instagram_basic`, `pages_show_list` and `pages_read_engagement`. While the app
is in **Development mode** these work *without review* for people who hold a role
on the app — enough for this test, and for a site only you use. Letting other
people connect their own accounts means submitting for App Review and Business
Verification; budget weeks, not days.

**Rate limit.** 25 published posts per Instagram account per rolling 24 hours.

---

## 4. Run it end to end

```bash
npm run doctor          # everything green, or a specific reason why not
npm run serve:status    # web, worker and dev all up
```

1. **Social accounts** — connect YouTube and Instagram. Both should show a real
   avatar and follower count; that read came back from the live API.
2. **Workflows → Bedroom picker → Steps** — the pipeline runs
   idea → images → music → beat slideshow → text overlay → draft.
3. Change the last step from **Create draft** to **Publish**, pick both channels,
   and set it to *Create draft* first if you want a look before anything goes out.
4. **Run now**, and watch the run view. Each step shows its own timer and state.
5. The finished 1080×1920 video lands in **Media**, and the post appears in
   **Queue** with a live platform URL once it publishes.

To prove the unattended path — the point of the whole thing — turn on the
workflow's schedule, then trigger the cron endpoint with no browser session:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/workflows
```

It answers with how many runs it started. `{"started":0}` means nothing was due:
the endpoint only starts workflows whose schedule is enabled and whose next run
time has passed — it is not a way to trigger a run by hand. The running worker
polls for the same thing every 30 seconds, so on this machine the endpoint is
really only there to prove a cron-only deployment would work.

## Running this for real, at zero cost, with nobody's machine involved

Here is a genuinely $0 architecture that runs unattended — no laptop has to stay
on, and nothing in it can silently turn into a bill. Each row checked against
that provider's own current docs, not a pricing blog:

| Piece | Where | Card required? | What happens if you exceed the free tier |
|---|---|---|---|
| Web app (OAuth callbacks, the public site) | **Vercel Hobby** | No | The specific feature pauses for the rest of the 30-day window. Not a charge — Vercel's own docs: "there are no billing cycles" on Hobby. |
| Database | **Neon** free plan | No | Compute suspends until next month. Explicitly a permanent free plan, not a trial. |
| Media storage | **Cloudflare R2** (already set up) | — | Already your call; check the free-tier ceiling in your own Cloudflare dashboard if this matters to you. |
| Worker (ffmpeg, cron polling) | **GitHub Actions**, on a schedule | No, for the free minutes | Usage is **blocked**, not billed, on an account with no payment method on file — GitHub's own words. |

The worker is the one piece that has to run continuously to catch scheduled
work, and continuous is exactly what every cloud VM with a genuine always-free
tier (Oracle, Google Cloud) makes you pay for with a card on file as an
anti-fraud check — and Google Cloud's own docs say it auto-bills past the free
allowance once you leave the 90-day trial, rather than simply blocking further
use. Not worth taking on.

GitHub Actions sidesteps the whole question because it never stays running. A
schedule starts a fresh Ubuntu VM, the VM does one pass of due work, and it is
thrown away — nothing to leave on, nothing to forget about, nothing to pay for
by the hour. `src/worker/run-once.ts` is that one pass: it runs the same scans
and job draining `src/worker/index.ts` does, then exits, instead of looping
forever with `setInterval`. `.github/workflows/worker.yml` runs it every 5
minutes — the shortest interval GitHub allows.

### Setting it up

1. In the repo's GitHub settings: **Settings → Secrets and variables → Actions**
   → **New repository secret**, one per value the workflow needs — everything in
   `.github/workflows/worker.yml` under `env:` that reads `secrets.SOMETHING`.
   These are the same values as your local `.env`, entered once, here — not
   re-entered per run.
2. Push the workflow file. It starts running on its own schedule from then on.
3. To test it without waiting for the clock: **Actions tab → Scheduled worker →
   Run workflow**. Watch the log; `[run-once] done — claimed N job(s)` on an idle
   repo means it is wired correctly and simply found nothing due.

### Making it feel instant

The setup above alone means confirming "run this workflow" can sit for up to 5
minutes before anything visibly happens — correct, but not what "professional"
feels like. This closes that gap without adding a second host: the app pings
GitHub's own on-demand trigger for the *same* workflow file the moment there is
real work queued, rather than waiting for the next tick.

1. **github.com/settings/personal-access-tokens/new** — a fine-grained token,
   scoped to **only this repository**. Under **Repository permissions**, set
   **Workflows** to **Read and write**. Nothing else — this token can start a
   workflow run and nothing more, deliberately the narrowest thing that works.
   This is a different credential from every `secrets.SOMETHING` in the
   workflow file: those are what GitHub hands to a run it already started,
   this is what lets the app ask GitHub to start one.
2. In your deployment's environment variables (Vercel's dashboard, not GitHub's
   secrets — this is the app reading it, not the workflow):
   ```
   GITHUB_DISPATCH_TOKEN="<the token from step 1>"
   GITHUB_DISPATCH_REPO="<owner>/<repo>"
   ```
   `GITHUB_DISPATCH_WORKFLOW` and `GITHUB_DISPATCH_REF` default to `worker.yml`
   and `main`; only set them if either differs.
3. Restart. Confirm a workflow run and check the repo's **Actions** tab — a new
   run should appear within a few seconds, not up to 5 minutes later.

Leave all four unset and nothing changes: the schedule alone still catches
everything, just on its own timer. This is additive, never required.

Two things worth knowing about what it actually buys you:

**A burst collapses to one dispatch.** A workflow that fans out several steps
at once calls this several times in a row; a short debounce turns that into a
single "wake up" rather than one GitHub API call per job.

**It can never make anything worse.** A missing token, an expired one, GitHub
being briefly down — every failure here is caught and logged, never thrown.
The enqueue it was trying to speed up always succeeds regardless; at worst, it
falls back to exactly the up-to-5-minute experience you'd have had anyway.

### What this does not promise

**Timing is soft for anything genuinely unattended.** A post or workflow
scheduled to fire on its own, with nobody watching, still rides the plain
5-minute poll — the dispatch above only fires the moment *something enqueues
work through the running app*, which a schedule firing on GitHub's clock never
does. GitHub also does not guarantee the poll itself is exactly on time;
scheduled runs queue behind platform load, more so right at the top of the hour
when everyone's cron fires together. A few minutes of slack on unattended work
is the honest cost of the free tier.

**A quiet repo pauses its own schedule.** GitHub disables scheduled workflows
after a stretch of no repository activity — commit something occasionally, or
check the Actions tab if runs seem to have stopped appearing.

**Scope is intentionally narrower than the always-on worker.** `run-once.ts`
covers due posts and due workflows — the two things you're actually testing.
Analytics sync (meant to run every 6 hours) and recurrence expansion (daily) are
left out: calling them every 5 minutes instead would change their cadence
outright, not just run them more often. Add them back gated by a coarse time
check if you need them running unattended too.

**2,000 free minutes/month, on a private repo.** A run that finds nothing due
exits in seconds, so idle ticks cost almost nothing; the minutes go toward
runs that actually render video or publish something. If that ever becomes
tight, a public repo runs Actions with no minute limit at all — worth
weighing against whatever you don't want public.

Before treating anything as "live," run:

```bash
npm run doctor:production
```

Same checks as `npm run doctor`, but everything a local setup is allowed to
leave relaxed — mock providers, local disk, a default secret — is a hard failure
instead of a warning, plus the checks that only matter once something is public:
HTTPS origin, `CRON_SECRET` set, `AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY` real
and long enough, migrations applied.

**Storage stays exactly as configured.** That is the point of doing R2 first —
the bucket you're testing against locally is the same one Instagram fetches from
once the web app is on Vercel. Nothing about publishing changes when you deploy.
(The S3 client now sends `requestChecksumCalculation: 'WHEN_REQUIRED'` — a recent
AWS SDK default started attaching a checksum header to every upload that R2 does
not accept, so a routine `npm update` bumping `@aws-sdk/client-s3` could
otherwise turn every upload into a 400 with no code change on your side. Already
fixed here.)

**`APP_URL` becomes your Vercel domain**, permanently, and the tunnel disappears.
Update the redirect URIs in both the Meta app and the Google Cloud credentials to
match. Both accept several, so you can keep the local ngrok one registered
alongside it.

**The schedule is already the cron.** Each workflow carries its own weekday and
time, and a run is attributed to whoever created the workflow — nobody has to
be signed in or have a browser open, which is what makes it a fit for GitHub
Actions running unattended in the first place. `vercel.json` also lists
`/api/cron/workflows` alongside publish, analytics and recurrence; with the
GitHub Actions schedule handling the same scans every 5 minutes, those Vercel
crons are now a redundant backstop rather than load-bearing — harmless to leave
(the job dedupe keys make a duplicate scan a no-op), safe to remove if you'd
rather not think about them. What they cannot do either way is render video —
`/api/cron/*` runs inside a Vercel function with the timeouts on the table
above, so it can only start a run and drain a short step. Rendering only ever
happens where `run-once.ts` runs.

**Meta App Review is the long pole**, and it is free — it just takes calendar
time, not money. Development mode covers accounts you hold a role on, which is
enough for testing. The moment anyone else connects their own Instagram account
you need `instagram_content_publish` approved plus Business Verification.
Measured in weeks, so start it early if you'll ever need it.

**Secrets.** Nothing in `.env` should reach the repo. Vercel's own environment
variable store holds the production values — set once in its dashboard, never
edited per-deploy. `TOKEN_ENCRYPTION_KEY` encrypts every stored social token at
rest — rotating it invalidates all of them and every user has to reconnect, so
set it once and keep a backup of it somewhere durable.

---

## If you want a dry run first

Leave one channel as a **demo** channel. A demo channel keeps its real platform
on the row, so the composer previews, validates and reports it as Instagram,
while its traffic is served by the in-repo mock. Nothing leaves the machine.

## Making YouTube uploads private while testing

An upload defaults to **public**. For a first run against a real channel, put
this in `.env` and restart:

```
YOUTUBE_PRIVACY_STATUS="private"
```

`public`, `unlisted` and `private` are all accepted. Remove it, or set it back to
`public`, once you are happy with what the pipeline produces.
