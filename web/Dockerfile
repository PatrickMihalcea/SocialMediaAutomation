# The always-on worker.
#
# The same code the scheduled GitHub Action runs, as a process that stays up.
# That Action exists because it needs no host; the cost is that a run only
# advances while a pass happens to be alive, and GitHub fires those when it
# feels like it — measured at roughly one every three hours against a schedule
# asking for one every five minutes. A nine-step run whose work takes ten
# minutes was finishing in four hours, almost all of it spent waiting for a
# worker to exist.
#
# Here the loop never stops: due workflows every 30s, due posts every 15s, the
# sweeper every 60s. Keep the Action as a backstop for when this host is down —
# they are safe to run together, because every claim is conditional.
FROM node:22-bookworm-slim

# ffmpeg renders the video; python runs the beat analysis. Both are the real
# work, so neither is optional.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-venv openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The audio analyser, in its own virtualenv — the same layout the repo uses
# locally, so PYTHON_BIN means the same thing in both places.
RUN python3 -m venv .venv-audio \
 && .venv-audio/bin/pip install --no-cache-dir --quiet librosa soundfile numpy

# Dependencies first, so a source change does not reinstall them.
COPY package.json package-lock.json ./
# npm ci when the lock is exact, npm install when it is not — sharp resolves
# platform-specific optional dependencies and a lock written on another OS does
# not carry the ones Linux needs.
#
# --include=dev deliberately: the worker is run through tsx, which lives in
# devDependencies. Omitting them builds an image that starts and immediately
# fails on `--import tsx`.
RUN npm ci --include=dev || npm install --include=dev

COPY . .
RUN npx prisma generate

# No --env-file here: the platform supplies the environment, and pointing at a
# .env that does not exist is how this fails on its first boot.
ENV NODE_OPTIONS=--conditions=react-server \
    NODE_ENV=production \
    PYTHON_BIN=/app/.venv-audio/bin/python \
    AUDIO_ANALYZER=librosa \
    RENDER_DRIVER=ffmpeg \
    IMAGE_USE_BIN=/app/vendor/image-use/image-use \
    IMAGE_USE_PYTHON=python3

CMD ["node", "--import", "tsx", "src/worker/index.ts"]
