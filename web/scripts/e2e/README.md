# Closed-loop end-to-end checks

`generate-image-loop.mjs` drives a real deployment with a headless browser and
proves the whole image path works end to end:

1. sign in at `/login`
2. open `/w/<workspace>/studio`
3. type a brief and press **Generate image**
4. wait for a card that was not on the page before
5. download the image bytes and write them to disk
6. open `/w/<workspace>/media` and confirm the same asset is listed and `READY`

Step 6 is the point. A generation that returns an image but never reaches the
Media Library is the regression this catches, and nothing that stays inside the
process can see it.

Exits `0` on success, `1` on failure. Every run writes a report, the downloaded
image, and screenshots (including one taken at the moment of failure) into
`E2E_OUT_DIR`, which is gitignored.

## Running it

```bash
E2E_BASE_URL="https://your-app.vercel.app" \
E2E_EMAIL="qa@example.com" \
E2E_PASSWORD="…" \
npm run test:e2e:image
```

Against a local server, point `E2E_BASE_URL` at `http://localhost:3000`.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `E2E_BASE_URL` | yes | — | The deployment to drive. No trailing slash needed. |
| `E2E_EMAIL` | yes | — | A test account. See the note on credentials below. |
| `E2E_PASSWORD` | yes | — | |
| `E2E_CHROME` | yes* | autodetected | Path to Chrome/Chromium. `playwright-core` bundles no browser, so this falls back to the usual macOS and Linux locations. |
| `E2E_WORKSPACE` | no | first workspace | Slug to generate into. Discovered from the account when unset. |
| `E2E_PROMPT` | no | a treehouse brief | The creative brief to type. |
| `E2E_IMAGE_SHAPE` | no | page default | Matches a label in the Image shape dropdown, e.g. `Portrait 2:3`. |
| `E2E_HEADLESS` | no | `true` | Set `false` to watch it run while debugging a selector. |
| `E2E_TIMEOUT_MS` | no | `240000` | Per-step budget. Real model calls are slow; raise it before assuming a bug. |
| `E2E_OUT_DIR` | no | `e2e-artifacts` | Where reports, images and screenshots land. |

\* Required only in the sense that the run fails without a browser; it is
autodetected on a normal developer machine.

## Use a dedicated test account

The run needs a password, and passing a real person's is how a password ends up
in a CI log or a shell history file. Create a QA account with access to one
throwaway workspace and use that. In CI, keep both values in the provider's
secret store — never in `vercel.json`, a workflow file, or `.env.example`.

## What the result means

The studio prints a **Demo mode is active** banner when `AI_PROVIDER` is not
`openai`; the report records this as `"demoMode": true`. A pass in demo mode
proves the plumbing — action, storage, library listing — but the pixels are a
local fixture, not model output. To exercise the real provider, run it against a
deployment with `AI_PROVIDER=openai`.

## The selectors it relies on

Three hooks in the app, all deliberate rather than incidental:

- `#studio-prompt` — the brief textarea (`src/components/ai-studio.tsx`)
- `data-asset-id` — on the studio's generated cards and on every Media Library
  card, which is how a specific asset is followed from one page to the other
- `data-asset-status` — on Media Library cards, so a `PROCESSING` asset is
  polled instead of failed

If you restructure either component, keep these attributes.
