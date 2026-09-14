export function buildClipInputArgs(
  clips: Array<{ file: string; kind: 'image' | 'video' }>,
): string[] {
  return clips.flatMap(({ file, kind }) =>
    kind === 'video' ? ['-stream_loop', '-1', '-i', file] : ['-i', file],
  );
}
