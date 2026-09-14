import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Button } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import {
  CATEGORY_LABEL,
  NODE_DEFINITIONS,
  type NodeType,
} from '@/lib/workflows/definitions';
import type { PortDefinition, PortType } from '@/lib/workflows/ports';
import { IMAGE_SIZE_PRESETS, imageSizeFitNote } from '@/lib/ai/image-sizes';
import {
  TEXT_OVERLAY_PRESETS,
  TEXT_OVERLAY_TOKENS,
  WORKFLOW_FIELD_HELP,
  WORKFLOW_RECIPES,
} from '@/lib/workflows/help';

export const metadata = { title: 'Workflow guide' };

export default async function WorkflowGuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireWorkspace(slug, 'workflow:view');

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="b88-eyebrow">Documentation</p>
          <h1 className="b88-page-title mt-3">Workflow guide</h1>
          <p className="b88-body-sm mt-3 max-w-2xl">
            Start with an outcome, connect matching ports, then configure only the details that
            change. Bridge88 validates the graph again before every run.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button href={`/w/${slug}/assistant`}>Ask the assistant</Button>
          <Button href={`/w/${slug}/workflows`} variant="secondary">Back to workflows</Button>
        </div>
      </div>

      <nav className="mt-8 rounded-lg border border-hairline p-5" aria-label="Workflow guide sections">
        <p className="b88-eyebrow">On this page</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <a href="#concepts">How connections work</a>
          <a href="#recipes">Starting recipes</a>
          <a href="#text-overlays">Text overlays</a>
          <a href="#formats">Shapes and formats</a>
          <a href="#mixed-media">Mixed media and trimming</a>
          <a href="#steps">Step reference</a>
          <a href="#troubleshooting">Troubleshooting</a>
        </div>
      </nav>

      <section id="concepts" className="mt-12 scroll-mt-20">
        <p className="b88-eyebrow">Core concepts</p>
        <h2 className="b88-section-title mt-3">Inputs receive. Outputs provide.</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <GuideCard title="Follow the data">
            Connections run from an output on the right of one step to an input on the left of
            another. A required input has an asterisk.
          </GuideCard>
          <GuideCard title="Shape matters">
            One image and a list of images are different shapes. Ports only connect when both the
            content type and the one-or-many shape match.
          </GuideCard>
          <GuideCard title="One source per input">
            An input accepts one connection. To swap what feeds it, remove the existing connection
            first.
          </GuideCard>
        </div>
        <div className="mt-6 rounded-lg border border-hairline p-5 text-sm">
          <p className="font-[540]">Selecting from a list</p>
          <p className="mt-2">
            Steps that generate or load media hand you a list. Put{' '}
            <Link href="#pick">Select items</Link> after it to choose by position or take a
            repeatable random sample. Use Selection for another list-based step, or First selected
            for a step that accepts one item. The utility keeps the media kind it receives.
          </p>
        </div>
        <div className="mt-6 rounded-lg bg-[var(--surface-soft)] p-5 text-sm">
          <p className="font-[540]">What the assistant can do</p>
          <p className="mt-2">
            Ask for an outcome in plain language. The assistant can propose a complete graph,
            schedule, and settings. You review the proposed steps before Bridge88 writes anything.
            Running and publishing remain separate actions.
          </p>
        </div>
      </section>

      <section id="recipes" className="mt-12 scroll-mt-20">
        <p className="b88-eyebrow">Starting recipes</p>
        <h2 className="b88-section-title mt-3">Describe one of these to the assistant</h2>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {WORKFLOW_RECIPES.map((recipe) => (
            <article key={recipe.name} className="rounded-lg border border-hairline p-5">
              <h3 className="b88-card-title">{recipe.name}</h3>
              <p className="mt-2 text-sm">{recipe.outcome}</p>
              <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">
                {recipe.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section id="text-overlays" className="mt-12 scroll-mt-20">
        <p className="b88-eyebrow">Text overlays</p>
        <h2 className="b88-section-title mt-3">Use presets first. Customize when needed.</h2>
        <p className="b88-body-sm mt-3 max-w-2xl">
          The Text overlay step creates different text for every cut. Curly-brace values are
          placeholders: Bridge88 replaces them when the workflow runs.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-hairline p-5">
            <p className="b88-label">Presets</p>
            <dl className="mt-4 space-y-4">
              {TEXT_OVERLAY_PRESETS.map((preset) => (
                <div key={preset.label}>
                  <dt className="font-[540]">{preset.label}</dt>
                  <dd className="mt-1 text-sm">
                    <code>{preset.value || 'empty'}</code> → {preset.example}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-lg border border-hairline p-5">
            <p className="b88-label">Available values</p>
            <dl className="mt-4 space-y-4">
              {TEXT_OVERLAY_TOKENS.map((token) => (
                <div key={token.token}>
                  <dt className="font-[540]"><code>{token.token}</code> · {token.label}</dt>
                  <dd className="mt-1 text-sm">{token.description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm">
              For Title, connect Titles from Idea generator to Image generator, then from
              Image generator to Beat slideshow. Fixed words are allowed: <code>Room {'{index}'}</code>.
            </p>
          </div>
        </div>
      </section>

      <section id="formats" className="mt-12 scroll-mt-20">
        <p className="b88-eyebrow">Shapes and formats</p>
        <h2 className="b88-section-title mt-3">Image shapes are not video formats</h2>
        <p className="b88-body-sm mt-3 max-w-2xl">
          The image model generates only 2:3, 3:2, and 1:1. None of those is 9:16, so a vertical
          video cannot be assembled from images that already match it. Beat slideshow resolves the
          difference, and Image fit decides how.
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="b88-table">
            <thead>
              <tr>
                <th>Image shape</th>
                <th>Video format</th>
                <th>What happens</th>
              </tr>
            </thead>
            <tbody>
              {IMAGE_SIZE_PRESETS.map((preset) => (
                <tr key={preset.id}>
                  <td>{preset.label}</td>
                  <td>{preset.suits}</td>
                  <td>{imageSizeFitNote(preset.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-2xl text-sm">
          Set Image fit to fill the frame when the subject is centred and the edges do not matter.
          Choose to show the full image when the whole composition counts; the spare area becomes a
          blurred backdrop rather than a crop.
        </p>
      </section>

      <section id="mixed-media" className="mt-12 scroll-mt-20">
        <p className="b88-eyebrow">Mixed media and trimming</p>
        <h2 className="b88-section-title mt-3">Build one deliberate sequence</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <GuideCard title="Combine image and video sources">
            Connect up to four image or video lists to Combine media. Connect each source&apos;s
            Titles beside it, then drag the sources into playback order. Chain another Combine
            media step when you need more than four sources. For a reusable opening clip, choose
            that specific item in Media library, connect it as Media 1, and put generated options
            after it as Media 2.
          </GuideCard>
          <GuideCard title="Trim before assembly">
            Trimmer accepts one audio track or video clip. Time range works for both. Musical bars
            is an audio-only mode retained for beat-aware workflows. A deterministic library
            selection can be previewed while you edit; random and generated media becomes available
            after the workflow runs.
          </GuideCard>
        </div>
      </section>

      <section id="steps" className="mt-12 scroll-mt-20">
        <p className="b88-eyebrow">Step reference</p>
        <h2 className="b88-section-title mt-3">Every available step</h2>
        <div className="mt-6 space-y-6">
          {(Object.entries(NODE_DEFINITIONS) as [NodeType, (typeof NODE_DEFINITIONS)[NodeType]][])
            .filter(([, definition]) => !('legacy' in definition && definition.legacy))
            .map(
            ([type, definition]) => {
              const fields = WORKFLOW_FIELD_HELP[type] ?? {};
              return (
                <article
                  key={type}
                  id={type.toLowerCase().replaceAll('_', '-')}
                  className="scroll-mt-20 rounded-lg border border-hairline p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Badge tone="outline">{CATEGORY_LABEL[definition.category]}</Badge>
                      <h3 className="b88-card-title mt-3">{definition.label}</h3>
                      <p className="mt-2 text-sm">{definition.description}</p>
                    </div>
                    {'longRunning' in definition && definition.longRunning && (
                      <Badge tone="cream">May take time</Badge>
                    )}
                  </div>
                  <div className="mt-5 grid gap-6 md:grid-cols-3">
                    <PortList title="Inputs" ports={definition.inputs} empty="No input required" />
                    <PortList title="Outputs" ports={definition.outputs} empty="No output" />
                    <div>
                      <p className="b88-label">Settings</p>
                      {Object.keys(fields).length ? (
                        <dl className="mt-3 space-y-3">
                          {Object.entries(fields).map(([key, field]) => (
                            <div key={key}>
                              <dt className="text-sm font-[540]">{field.label}</dt>
                              <dd className="mt-1 text-sm">{field.description}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="mt-3 text-sm">No settings.</p>
                      )}
                    </div>
                  </div>
                </article>
              );
            },
          )}
        </div>
      </section>

      <section id="troubleshooting" className="my-12 scroll-mt-20">
        <p className="b88-eyebrow">Troubleshooting</p>
        <h2 className="b88-section-title mt-3">Common graph problems</h2>
        <div className="mt-6 space-y-4">
          <GuideCard title="A port does not highlight">
            The content type or one-or-many shape does not match. If the output is a list and the
            input takes one, put Select items between them and use First selected.
          </GuideCard>
          <GuideCard title="Select items refuses to connect onward">
            Select items takes its kind from the list feeding it, so connect its Items input first.
            Use Selection for a list input and First selected for a single-item input. Rewiring it
            to an incompatible media kind is refused rather than left to fail mid-run.
          </GuideCard>
          <GuideCard title="Titles are blank">
            Connect both Titles links in the idea-to-slideshow path. Prompts create images; Titles
            carry the short display titles separately.
          </GuideCard>
          <GuideCard title="The workflow cannot run">
            Check every required input, select publishing channels, and make sure the media library
            contains an analysed track.
          </GuideCard>
        </div>
        <p className="mt-6 text-sm">
          Still blocked? <Link href={`/w/${slug}/assistant`}>Ask the assistant to inspect or revise the workflow.</Link>
        </p>
      </section>
    </>
  );
}

function GuideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="rounded-lg border border-hairline p-5">
      <h3 className="font-[540]">{title}</h3>
      <p className="mt-2 text-sm">{children}</p>
    </article>
  );
}

function PortList({
  title,
  ports,
  empty,
}: {
  title: string;
  ports: readonly PortDefinition[];
  empty: string;
}) {
  return (
    <div>
      <p className="b88-label">{title}</p>
      {ports.length ? (
        <dl className="mt-3 space-y-3">
          {ports.map((port) => (
            <div key={port.id}>
              <dt className="text-sm font-[540]">
                {port.label}{port.required ? ' · Required' : ''}
              </dt>
              <dd className="mt-1 text-sm">
                {port.followsInput ? `one item, matching the ${port.followsInput} it is given` : portTypeLabel(port.type)}
                {port.description ? ` · ${port.description}` : ''}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm">{empty}</p>
      )}
    </div>
  );
}

function portTypeLabel(type: PortType): string {
  const value = type.scalar === 'media'
    ? (type.mediaKinds?.map((kind) => kind.toLowerCase()).join(' or ') || 'media')
    : type.scalar === 'json' && type.schemaId
      ? type.schemaId
      : type.scalar;
  return type.list ? `${value} list` : `one ${value}`;
}
