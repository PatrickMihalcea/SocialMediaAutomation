export function buildClipInputArgs(
  clips: Array<{ file: string; kind: 'image' | 'video' }>,
): string[] {
  return clips.flatMap(({ file }) => ['-i', file]);
}
