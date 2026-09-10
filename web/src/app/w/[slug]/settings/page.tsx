import { Field, MediaUploader, Select, TextArea } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { COMMON_TIMEZONES } from '@/lib/scheduling/time';
import {
  deleteWorkspaceAction,
  transferWorkspaceOwnershipAction,
  updateWorkspaceAction,
  uploadWorkspaceLogoAction,
} from '@/app/actions/workspace';
import { ActionForm } from '@/components/action-form';
import { PendingButton } from '@/components/action-ui';
import { storage } from '@/lib/storage';
import { BrandVoiceForms } from './brand-voice-forms';

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'workspace:view');
  const brand = await db.brandSettings.findUnique({ where: { workspaceId: ctx.workspace.id } });
  const logoUrl = ctx.workspace.logoStorageKey
    ? await storage().signedUrl(ctx.workspace.logoStorageKey)
    : ctx.workspace.logoUrl;
  return (
    <>
      <p className="b88-eyebrow">Workspace</p>
      <h1 className="b88-page-title mt-3">Settings</h1>
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <ActionForm action={updateWorkspaceAction.bind(null, slug)} className="b88-card space-y-6">
          <div><p className="b88-caption">Brand information</p><h2 className="b88-heading mt-2">Workspace details</h2></div>
          <Field name="name" label="Name" defaultValue={ctx.workspace.name} required />
          <Field name="slug" label="Workspace URL slug" defaultValue={ctx.workspace.slug} required hint="Lowercase letters, numbers, and hyphens. Existing links change when this changes." />
          <Field name="website" label="Website" type="url" defaultValue={ctx.workspace.website ?? ''} />
          <TextArea name="description" label="Description" rows={4} defaultValue={ctx.workspace.description ?? ''} />
          <Field name="industry" label="Industry" defaultValue={ctx.workspace.industry ?? ''} />
          <Field name="targetAudience" label="Target audience" defaultValue={ctx.workspace.targetAudience ?? ''} />
          <Select
            name="timezone"
            label="Timezone"
            defaultValue={ctx.workspace.timezone}
            hint="Existing publication instants stay fixed. Calendar clock times may display differently after a change."
          >
            {COMMON_TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}
          </Select>
          <Select name="defaultLanguage" label="Default language" defaultValue={ctx.workspace.defaultLanguage}><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="ro">Romanian</option></Select>
          {ctx.can('workspace:update') && <PendingButton type="submit" pendingLabel="Saving workspace">Save workspace</PendingButton>}
        </ActionForm>

        {ctx.can('brand:update') && (
          <BrandVoiceForms
            slug={slug}
            brand={brand ?? {
              tone: '',
              personality: '',
              targetAudience: '',
              writingStyle: '',
              wordsToUse: [],
              wordsToAvoid: [],
              emojiPolicy: 'SPARING',
              hashtagPolicy: 'MODERATE',
              ctaStyle: '',
              additionalInstructions: '',
            }}
            context={[ctx.workspace.description, ctx.workspace.targetAudience, ctx.workspace.industry].filter(Boolean).join('\n')}
          />
        )}
      </div>

      {ctx.can('workspace:update') && (
        <ActionForm action={uploadWorkspaceLogoAction.bind(null, slug)} className="b88-card mt-6 space-y-6" encType="multipart/form-data">
          <div><p className="b88-caption">Brand asset</p><h2 className="b88-heading mt-2">Workspace logo</h2></div>
          {logoUrl && <img src={logoUrl} alt={`${ctx.workspace.name} logo`} className="size-20 rounded-md object-contain" />}
          <MediaUploader
            name="logo"
            title="Drop your logo here"
            hint="JPG, PNG, or WebP · up to 2 MB"
            accept="image/jpeg,image/png,image/webp"
            multiple={false}
            compact
            required
          />
          <PendingButton type="submit" pendingLabel="Uploading logo">Upload logo</PendingButton>
        </ActionForm>
      )}

      {ctx.role === 'OWNER' && (
        <section className="mt-6 rounded-lg bg-[var(--block-pink)] p-8">
          <p className="b88-caption">Ownership</p><h2 className="b88-heading mt-2">Transfer or delete</h2>
          <p className="mt-2">Transfer ownership to an existing member, or permanently delete this workspace.</p>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <ActionForm action={transferWorkspaceOwnershipAction.bind(null, slug)} className="rounded-md bg-canvas p-5 space-y-4">
              <p className="text-sm">The new owner receives full control. Your role changes to Admin.</p>
              <Field name="email" type="email" label="New owner member email" required />
              <Field name="confirmation" label="Type TRANSFER to confirm" autoComplete="off" required />
              <PendingButton type="submit" variant="secondary" pendingLabel="Transferring ownership">Transfer ownership</PendingButton>
            </ActionForm>
            <ActionForm action={deleteWorkspaceAction.bind(null, slug)} className="rounded-md bg-canvas p-5 space-y-4">
              <p className="text-sm">This permanently deletes posts, media, campaigns, social connections, analytics, team access, and stored files. This cannot be undone.</p>
              <Field name="confirmation" label={`Type “${ctx.workspace.name}” to confirm`} autoComplete="off" required />
              <PendingButton type="submit" variant="primary" pendingLabel="Deleting workspace">Delete workspace</PendingButton>
            </ActionForm>
          </div>
        </section>
      )}
    </>
  );
}
