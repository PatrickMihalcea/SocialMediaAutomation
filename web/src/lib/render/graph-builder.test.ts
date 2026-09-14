import { describe, expect, it } from 'vitest';
import { buildEncoderArgs, buildFilterGraph } from '@/lib/render/graph-builder';
import type { ResolvedRenderPlan } from '@/lib/render/types';

function plan(overrides: Partial<ResolvedRenderPlan> = {}): ResolvedRenderPlan {
  return {
    width: 1080,
    height: 1920,
    fps: 30,
    totalFrames: 225,
    supersample: 2,
    images: [],
    deterministic: false,
    audio: {
      bytes: Buffer.alloc(0),
      mimeType: 'audio/mpeg',
      startSeconds: 12.345,
      fadeInSeconds: 0.04,
      fadeOutSeconds: 1.2,
    },
    segments: [
      { imageIndex: 0, startFrame: 0, endFrame: 60, motion: { fromZoom: 1, toZoom: 1.1 }, overlays: [overlay('1')] },
      { imageIndex: 1, startFrame: 60, endFrame: 150, motion: { fromZoom: 1.1, toZoom: 1 }, overlays: [overlay('2')] },
      { imageIndex: 2, startFrame: 150, endFrame: 225, motion: { fromZoom: 1, toZoom: 1.1 }, overlays: [overlay('3')] },
    ],
    ...overrides,
  };
}

function overlay(label: string) {
  return {
    text: label,
    textFile: `/tmp/b88/t${label}.txt`,
    fontFile: '/opt/app/assets/fonts/Archivo-Bold.ttf',
    fontSize: 132,
    colour: 'white',
    strokeWidth: 10,
    strokeColour: 'black',
    lineSpacing: 14,
    x: '(w-text_w)/2',
    y: '220',
  };
}

describe('buildFilterGraph', () => {
  it('produces a stable graph for a known plan', () => {
    expect(buildFilterGraph(plan())).toMatchInlineSnapshot(`
      "[0:v]zoompan=z='1.0000+0.1000*on/59':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=60:s=2160x3840:fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=rgb24[c0];
      [1:v]zoompan=z='1.1000-0.1000*on/89':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=90:s=2160x3840:fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=rgb24[c1];
      [2:v]zoompan=z='1.0000+0.1000*on/74':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=75:s=2160x3840:fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=rgb24[c2];
      [c0][c1][c2]concat=n=3:v=1:a=0[seq];
      [seq]drawtext=fontfile=/opt/app/assets/fonts/Archivo-Bold.ttf:textfile=/tmp/b88/t1.txt:fontsize=132:fontcolor=white:borderw=10:bordercolor=black:line_spacing=14:text_shaping=0:reload=0:x=(w-text_w)/2:y=220:enable='between(n,0,59)',drawtext=fontfile=/opt/app/assets/fonts/Archivo-Bold.ttf:textfile=/tmp/b88/t2.txt:fontsize=132:fontcolor=white:borderw=10:bordercolor=black:line_spacing=14:text_shaping=0:reload=0:x=(w-text_w)/2:y=220:enable='between(n,60,149)',drawtext=fontfile=/opt/app/assets/fonts/Archivo-Bold.ttf:textfile=/tmp/b88/t3.txt:fontsize=132:fontcolor=white:borderw=10:bordercolor=black:line_spacing=14:text_shaping=0:reload=0:x=(w-text_w)/2:y=220:enable='between(n,150,224)',setpts=N/30/TB,format=yuv420p[v];
      [3:a]atrim=start=12.345000,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.040,afade=t=out:st=6.300:d=1.200,aresample=48000:first_pts=0,atrim=0:7.500000,asetpts=PTS-STARTPTS[a]"
    `);
  });

  it('gives overlay ranges that never share a frame', () => {
    // between() is inclusive at both ends, so ranges expressed in seconds would
    // double-draw on the boundary. Frame indices make the handover exact.
    const graph = buildFilterGraph(plan());
    expect(graph).toContain("enable='between(n,0,59)'");
    expect(graph).toContain("enable='between(n,60,149)'");
    expect(graph).not.toContain("enable='between(n,0,60)'");
  });

  it('always pins zoompan size and fps', () => {
    // Unset, s= defaults to hd720 and fps= to 25 — both silently wrong.
    const graph = buildFilterGraph(plan());
    const zoompans = graph.match(/zoompan=[^,]+/g) ?? [];
    expect(zoompans).toHaveLength(3);
    for (const filter of zoompans) {
      expect(filter).toContain('s=2160x3840');
      expect(filter).toContain('fps=30');
    }
  });

  it('never emits the recursive zoom form that pops at clip starts', () => {
    expect(buildFilterGraph(plan())).not.toContain('zoom+');
  });

  it('escapes a font path containing a colon', () => {
    const withColon = plan({
      segments: [
        {
          imageIndex: 0,
          startFrame: 0,
          endFrame: 30,
          motion: null,
          overlays: [{ ...overlay('1'), fontFile: 'C:/fonts/Archivo.ttf' }],
        },
      ],
      totalFrames: 30,
    });
    expect(buildFilterGraph(withColon)).toContain('C\\:/fonts/Archivo.ttf');
  });

  it('omits the audio chain when there is no track', () => {
    const graph = buildFilterGraph(plan({ audio: null }));
    expect(graph).not.toContain('atrim');
    expect(graph).not.toContain('[a]');
  });
});

describe('buildEncoderArgs', () => {
  it('stamps nothing version-dependent into the output', () => {
    const args = buildEncoderArgs({ fps: 30, audio: null, deterministic: false });
    expect(args).toContain('+bitexact');
    expect(args).toContain('-map_metadata');
  });

  it('drops to single-threaded x264 when byte-reproducibility is asked for', () => {
    // Multi-threaded x264 is not bit-reproducible at any thread count but its own.
    const args = buildEncoderArgs({ fps: 30, audio: null, deterministic: true });
    expect(args.join(' ')).toContain('threads=1');
  });
});
