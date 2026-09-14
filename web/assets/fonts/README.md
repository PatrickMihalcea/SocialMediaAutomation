# Render fonts

Copied here from the repo-root `Fonts/` directory, which sits outside `web/` and
is therefore not part of the Next.js deploy bundle.

Only the portable faces are copied. `Arial Unicode.ttf` in the source directory
is a symlink into `/System/Library/Fonts/Supplemental/` and would dangle on any
Linux host, and the X11 registration files (`fonts.dir`, `fonts.scale`,
`encodings.dir`) are not used — ffmpeg's `drawtext` is given an absolute
`fontfile=` path rather than resolving a family name through fontconfig, which
would not be reproducible across machines.

Override the location with `RENDER_FONT_DIR`.
