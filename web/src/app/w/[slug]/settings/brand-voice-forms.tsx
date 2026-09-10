'use client';

import { useActionState } from 'react';
import { Field, Select, StatusMessage, TextArea } from '@/bridge88/components';
import {
  inferBrandVoiceAction,
  updateBrandVoiceAction,
  type BrandVoicePreviewState,
} from '@/app/actions/workspace';
import { PendingButton } from '@/components/action-ui';
import type { BrandSettings } from '@prisma/client';
import type { BrandVoiceDraft } from '@/lib/ai/schemas';

type BrandValues = BrandVoiceDraft | Pick<
  BrandSettings,
  | 'tone'
  | 'personality'
  | 'targetAudience'
  | 'writingStyle'
  | 'wordsToUse'
  | 'wordsToAvoid'
  | 'emojiPolicy'
  | 'hashtagPolicy'
  | 'ctaStyle'
  | 'additionalInstructions'
>;

function BrandEditor({ slug, values }: { slug: string; values: BrandValues }) {
  const [state, action] = useActionState(updateBrandVoiceAction.bind(null, slug), {});
  const words = (value: string[] | undefined) => value?.join(', ') ?? '';

  return (
    <form action={action} className="b88-card space-y-6">
      <div>
        <p className="b88-caption">AI context</p>
        <h2 className="b88-heading mt-2">Brand voice</h2>
        <p className="mt-2 text-sm">These saved rules guide copy generated across this workspace.</p>
      </div>
      {state.error && <StatusMessage tone="error">{state.error}</StatusMessage>}
      {state.success && <StatusMessage tone="success">{state.success}</StatusMessage>}
      <Field name="tone" label="Tone" defaultValue={values.tone ?? ''} />
      <Field name="personality" label="Personality" defaultValue={values.personality ?? ''} />
      <Field name="targetAudience" label="Audience" defaultValue={values.targetAudience ?? ''} />
      <TextArea name="writingStyle" label="Writing style" rows={3} defaultValue={values.writingStyle ?? ''} />
      <Field name="wordsToUse" label="Words to use · comma separated" defaultValue={words(values.wordsToUse)} />
      <Field name="wordsToAvoid" label="Words to avoid · comma separated" defaultValue={words(values.wordsToAvoid)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select name="emojiPolicy" label="Emoji policy" defaultValue={values.emojiPolicy ?? 'SPARING'}>
          <option value="NONE">None</option>
          <option value="SPARING">Sparing</option>
          <option value="FREELY">Freely</option>
        </Select>
        <Select name="hashtagPolicy" label="Hashtag policy" defaultValue={values.hashtagPolicy ?? 'MODERATE'}>
          <option value="NONE">None</option>
          <option value="MINIMAL">Minimal</option>
          <option value="MODERATE">Moderate</option>
          <option value="HEAVY">Heavy</option>
        </Select>
      </div>
      <Field name="ctaStyle" label="CTA style" defaultValue={values.ctaStyle ?? ''} />
      <TextArea name="additionalInstructions" label="Additional instructions" rows={4} defaultValue={values.additionalInstructions ?? ''} />
      <PendingButton type="submit" pendingLabel="Saving voice">Save brand voice</PendingButton>
    </form>
  );
}

export function BrandVoiceForms({
  slug,
  brand,
  context,
}: {
  slug: string;
  brand: BrandValues;
  context: string;
}) {
  const [previewState, previewAction] = useActionState<BrandVoicePreviewState, FormData>(
    inferBrandVoiceAction.bind(null, slug),
    {},
  );
  const values = previewState.preview ?? brand;

  return (
    <div className="space-y-6">
      <BrandEditor key={previewState.preview ? JSON.stringify(previewState.preview) : 'saved'} slug={slug} values={values} />
      <form action={previewAction} className="rounded-lg bg-[var(--block-lilac)] p-8">
        <p className="b88-caption">AI preview</p>
        <h2 className="b88-heading mt-2">Generate from business context</h2>
        <p className="mt-2 text-sm">Generation does not change saved settings. Review the populated fields, then save.</p>
        {previewState.error && <StatusMessage tone="error" className="mt-5">{previewState.error}</StatusMessage>}
        {previewState.success && <StatusMessage tone="success" className="mt-5">{previewState.success}</StatusMessage>}
        <TextArea name="description" label="Brand context" rows={4} containerClassName="mt-6" defaultValue={context} required />
        <PendingButton type="submit" variant="secondary" className="mt-6" pendingLabel="Generating preview">
          Generate preview
        </PendingButton>
      </form>
    </div>
  );
}
