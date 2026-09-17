# image-use (vendored)

Upstream: https://github.com/leeguooooo/image-use — version 0.29.0, unmodified.

Vendored rather than installed because the scheduled worker checks this repo out
onto a fresh VM every five minutes. `curl | sh` at run time would mean executing
whatever `main` happens to hold that minute, with an OAuth token for a real
ChatGPT account in the environment. A pinned file in the repo makes an upgrade a
reviewable commit instead.

`image-use` is a single self-contained Python file — no pip, no dependencies,
python3 ≥ 3.10. `SKILL.md` is upstream's own documentation of every flag.

Used by `src/lib/ai/providers/image-use.ts`. How it is wired for deployment is
in `docs/deploying.md` step 5.

## Upgrading

```bash
curl -fsSL https://raw.githubusercontent.com/leeguooooo/image-use/main/image-use \
  -o web/vendor/image-use/image-use
chmod +x web/vendor/image-use/image-use
python3 web/vendor/image-use/image-use --version
```

Then re-run the live check before trusting it unattended:

```bash
cd web && IMAGE_USE_E2E=1 IMAGE_USE_MODEL=gpt-5.5 \
  npx vitest run src/lib/ai/providers/image-use.test.ts
```
