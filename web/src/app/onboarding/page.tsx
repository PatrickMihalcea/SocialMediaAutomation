import { redirect } from 'next/navigation';
import { Button, Field, TextArea } from '@/bridge88/components';
import { COMMON_TIMEZONES } from '@/lib/scheduling/time';
import { listMyWorkspaces, requireUser, requireWorkspace } from '@/lib/auth/guard';
import { advanceOnboardingAction, createWorkspaceAction } from '@/app/actions/workspace';
import { ActionForm } from '@/components/action-form';
import { PendingButton } from '@/components/action-ui';
import { db } from '@/lib/db';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  await requireUser();
  const query = await searchParams;
  const existing = await listMyWorkspaces();
  const selected = query.workspace
    ? existing.find((workspace) => workspace.slug === query.workspace)
    : existing.find((workspace) => !workspace.onboardedAt);
  if (existing.length && !selected) redirect(`/w/${existing[0].slug}`);
  if (selected?.onboardedAt) redirect(`/w/${selected.slug}`);

  if (!selected) return <WorkspaceDetails />;

  const ctx = await requireWorkspace(selected.slug);
  const brand = await db.brandSettings.findUnique({ where: { workspaceId: ctx.workspace.id } });
  const step = Math.max(2, Math.min(4, ctx.workspace.onboardingStep));
  const progress = Math.round((step / 4) * 100);

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-12 md:px-12" tabIndex={-1}>
      <p className="b88-eyebrow">Workspace setup · {step} of 4</p>
      <div className="mt-4 h-2 overflow-hidden rounded-pill bg-surface-soft" aria-label={`${progress}% complete`}>
        <div className="h-full bg-[var(--primary)]" style={{ width: `${progress}%` }} />
      </div>
      {step === 2 && <BrandVoiceStep slug={selected.slug} brand={brand} />}
      {step === 3 && <ChannelStep slug={selected.slug} />}
      {step === 4 && <FirstPostStep slug={selected.slug} />}
    </main>
  );
}

function WorkspaceDetails() {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-12 md:px-12" tabIndex={-1}>
      <p className="b88-eyebrow">Workspace setup · 1 of 4</p>
      <h1 className="b88-page-title mt-4">Tell Bridge88 what you publish.</h1>
      <p className="mt-4 max-w-2xl text-lg">These details scope every post and give the writing tools useful context.</p>
      <ActionForm action={createWorkspaceAction} className="b88-card mt-10 grid gap-6">
        <Field name="name" label="Brand or workspace name" required />
        <Field name="website" label="Website" type="url" placeholder="https://" />
        <TextArea name="description" label="What does the business do?" rows={4} required />
        <Field name="industry" label="Industry" />
        <Field name="targetAudience" label="Target audience" placeholder="Software teams at growing companies" />
        <label><span className="b88-label">Timezone</span><select name="timezone" className="b88-input" defaultValue="UTC">{COMMON_TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
        <label><span className="b88-label">Default language</span><select name="defaultLanguage" className="b88-input" defaultValue="en"><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="ro">Romanian</option></select></label>
        <div className="flex justify-end"><PendingButton type="submit" className="w-full sm:w-auto" pendingLabel="Creating workspace">Create workspace</PendingButton></div>
      </ActionForm>
    </main>
  );
}

type Brand = Awaited<ReturnType<typeof db.brandSettings.findUnique>>;

function BrandVoiceStep({ slug, brand }: { slug: string; brand: Brand }) {
  return (
    <>
      <h1 className="b88-page-title mt-6">Review the AI brand voice.</h1>
      <p className="mt-4">Bridge88 inferred this editable preview from your workspace details. Mock mode returns deterministic copy.</p>
      <ActionForm action={advanceOnboardingAction.bind(null, slug, 2)} className="b88-card mt-8 grid gap-6">
        <Field name="tone" label="Tone" defaultValue={brand?.tone ?? ''} />
        <Field name="personality" label="Personality" defaultValue={brand?.personality ?? ''} />
        <Field name="targetAudience" label="Audience" defaultValue={brand?.targetAudience ?? ''} />
        <TextArea name="writingStyle" label="Writing style" rows={3} defaultValue={brand?.writingStyle ?? ''} />
        <Field name="wordsToUse" label="Words to use · comma separated" defaultValue={brand?.wordsToUse.join(', ') ?? ''} />
        <Field name="wordsToAvoid" label="Words to avoid · comma separated" defaultValue={brand?.wordsToAvoid.join(', ') ?? ''} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className="b88-label">Emoji policy</span><select name="emojiPolicy" className="b88-input" defaultValue={brand?.emojiPolicy ?? 'SPARING'}><option>NONE</option><option>SPARING</option><option>FREELY</option></select></label>
          <label><span className="b88-label">Hashtag policy</span><select name="hashtagPolicy" className="b88-input" defaultValue={brand?.hashtagPolicy ?? 'MODERATE'}><option>NONE</option><option>MINIMAL</option><option>MODERATE</option><option>HEAVY</option></select></label>
        </div>
        <Field name="ctaStyle" label="CTA style" defaultValue={brand?.ctaStyle ?? ''} />
        <TextArea name="additionalInstructions" label="Additional instructions" rows={3} defaultValue={brand?.additionalInstructions ?? ''} />
        <div className="flex justify-end"><PendingButton type="submit" className="w-full sm:w-auto" pendingLabel="Saving voice">Save and continue</PendingButton></div>
      </ActionForm>
    </>
  );
}

function ChannelStep({ slug }: { slug: string }) {
  return (
    <>
      <h1 className="b88-page-title mt-6">Choose the first channel.</h1>
      <p className="mt-4">We’ll add a demo channel so you can practise scheduling. Real network login is optional later.</p>
      <ActionForm action={advanceOnboardingAction.bind(null, slug, 3)} className="b88-card mt-8 space-y-6">
        <label><span className="b88-label">Social platform</span><select name="platform" className="b88-input" defaultValue="LINKEDIN"><option value="LINKEDIN">LinkedIn demo</option><option value="INSTAGRAM">Instagram demo</option><option value="FACEBOOK">Facebook demo</option><option value="X">X demo</option><option value="TIKTOK">TikTok demo</option><option value="YOUTUBE">YouTube demo</option></select></label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button type="submit" name="skip" value="true" variant="tertiary" className="w-full sm:w-auto">Skip for now</Button>
          <PendingButton type="submit" className="w-full sm:w-auto" pendingLabel="Creating channel">Create demo channel</PendingButton>
        </div>
      </ActionForm>
    </>
  );
}

function FirstPostStep({ slug }: { slug: string }) {
  return (
    <>
      <h1 className="b88-page-title mt-6">Write the first post.</h1>
      <p className="mt-4">Save one draft for the demo channel, or finish setup without one.</p>
      <ActionForm action={advanceOnboardingAction.bind(null, slug, 4)} className="b88-card mt-8 space-y-6">
        <Field name="title" label="Internal title" placeholder="First campaign note" />
        <TextArea name="text" label="Caption" rows={8} placeholder="Write one useful thing." />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button type="submit" name="skip" value="true" variant="tertiary" className="w-full sm:w-auto">Skip and finish</Button>
          <PendingButton type="submit" className="w-full sm:w-auto" pendingLabel="Saving first post">Save draft and finish</PendingButton>
        </div>
      </ActionForm>
    </>
  );
}
