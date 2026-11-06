# Local generation with ComfyUI

Images, edits and video rendered on your own Mac, at no per-image cost. The
catch: work only runs while the Mac is on, ComfyUI is open and the local worker
is running. Anything queued in the meantime **waits**. It does not fail.

## How it fits together

```
Vercel / GitHub Actions                         Your Mac
───────────────────────                         ────────
Studio or workflow step picks "ComfyUI"
  → job row on the LOCAL_GENERATION queue ──►  npm run worker:local
    (cloud workers never take these)              polls Neon for those jobs
                                                  → ComfyUI on localhost:8188
                                                  → uploads the result to R2
  ◄── asset row + R2 object, same as any other ───┘
```

Nothing on the Mac is exposed to the internet. The worker only makes outbound
connections: to Neon, to R2 and to ComfyUI on localhost.

## Setup

1. **Run ComfyUI.** Install ComfyUI (the desktop app or a git checkout), then
   download the models your workflows use. It listens on
   `http://127.0.0.1:8188` by default; the desktop app may use port 8000
   instead, so check its settings.

2. **Export a workflow for each operation you want.** Build the workflow in
   ComfyUI, then use **Workflow → Export (API)**. The ordinary *Save* format
   will not load here. Save it in `comfyui/workflows/` under the name of the
   operation it serves:

   | File | Used by |
   |---|---|
   | `txt2img.json` | Image generator steps and studio images |
   | `img2vid.json` | Animate image steps and "Animate selected image" in the studio |
   | `txt2vid.json` | "Generate video" in the studio |
   | `edit.json` | Studio image edits |
   | `variation.json` | Studio variations |

   You only need the files for the operations you use. A missing one fails
   that job with a message naming the file. `examples/txt2img.json` is a
   starting point for plain SDXL.

3. **Replace the inputs with placeholders.** Edit the exported JSON and put a
   placeholder wherever this app should fill something in:

   | Placeholder | Becomes |
   |---|---|
   | `{{prompt}}` | The prompt (style and reference notes included) |
   | `{{negative_prompt}}` | Empty for now |
   | `{{width}}`, `{{height}}` | The requested size, rounded to a multiple of 16 |
   | `{{seed}}` | A random seed per render |
   | `{{image}}` | The source image (edit, variation, img2vid). Put it in a **Load Image** node's `image` |
   | `{{subject_image}}`, `{{style_image}}`, `{{composition_image}}` | Reference pictures from an Image generator step, each in its own **Load Image** node |

   A value that is only a placeholder (`"width": "{{width}}"`) is replaced by a
   real number. A placeholder inside longer text is spliced into that text.

4. **Reference pictures pick the file.** Keep several `txt2img` variants side
   by side, for example `txt2img.json`, `txt2img-style.json` (IP-Adapter wired
   to `{{style_image}}`) and `txt2img-subject-style.json`. Each render uses the
   file that takes the most of the references the step actually has, and never
   one that needs a reference the step lacks. A step with no references always
   gets plain `txt2img.json`.

5. **Configure the worker.** Create `web/.env.local-worker`; it is gitignored.
   Give it the production values the worker needs to reach the same database
   and storage as the app. The worker reads `.env` first and then this file,
   so values here win.

   ```
   DATABASE_URL=...          # the Neon URL production uses
   TOKEN_ENCRYPTION_KEY=...
   STORAGE_DRIVER=s3
   S3_ENDPOINT=...  S3_BUCKET=...  S3_ACCESS_KEY_ID=...  S3_SECRET_ACCESS_KEY=...  S3_REGION=auto
   COMFYUI_URL=http://127.0.0.1:8188
   ```

6. **Start the worker.** Run `npm run worker:local` from `web/`. It logs when
   ComfyUI answers and when each job starts and finishes. To have it start at
   login instead:

   ```
   cp comfyui/com.bridge88.local-worker.plist ~/Library/LaunchAgents/
   # edit the two /PATH/TO placeholders in the copy, then:
   launchctl load ~/Library/LaunchAgents/com.bridge88.local-worker.plist
   ```

## Using it

- **Studio:** choose **ComfyUI — your Mac, queued** under *Generate images
  with*. With ComfyUI selected, *Generate video*, *Animate selected image* and
  variations also run on it. The panel shows whether your Mac is online.
- **Image generator step:** set *Generate with* to ComfyUI. The 9:16 size is
  available.
- **Animate image step:** set *Animate with* to ComfyUI.
- A workflow with a ComfyUI step shows the Mac's status above the canvas.

## Behaviour worth knowing

- **One render at a time.** Set `LOCAL_WORKER_CONCURRENCY` to run more, but
  two renders on one GPU each take twice as long.
- **Stopping the worker mid-render is safe.** The job goes back to the queue
  and starts again from the beginning on the next start. Image steps keep the
  images they had already finished.
- **ComfyUI being closed costs nothing.** The worker takes no work until
  ComfyUI answers.
- **Errors are reported as-is.** A model that isn't installed, a missing node
  or an out-of-memory error fails the job with ComfyUI's own message. Out of
  memory is retried; the others are not.
- **Time limit.** `COMFYUI_TIMEOUT_MS` (45 minutes by default) caps a single
  render.
- **Workflow files are read on every job,** so an edited file takes effect
  without restarting the worker.
