import { Suspense } from 'react';
import { Checkbox, Field, MediaUploader, Select, TextArea } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { timezoneLabel, timezoneOptions } from '@/lib/scheduling/time';
import {
  deleteWorkspaceAction,
  transferWorkspaceOwnershipAction,
  updateWorkspaceAction,
  updateWorkspacePreferencesAction,
  uploadWorkspaceLogoAction,
} from '@/app/actions/workspace';
import { ActionForm } from '@/components/action-form';
import { PendingButton } from '@/components/action-ui';
import { storage } from '@/lib/storage';
import { SettingsPagePreview } from '@/components/page-previews';
import { BrandVoiceForms } from './brand-voice-forms';
import { SettingsSection } from './settings-section';

export const metadata = { title: 'Settings' };

export default function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <>
      <p className="b88-eyebrow">Workspace</p>
      <h1 className="b88-page-title mt-3">Settings</h1>
      <Suspense fallback={<SettingsPagePreview />}>
        <SettingsData params={params} />
      </Suspense>
    </>
  );
}
async function SettingsData({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'workspace:view');
  const [brand, preferences] = await Promise.all([
    db.brandSettings.findUnique({ where: { workspaceId: ctx.workspace.id } }),
    db.workspacePreferences.findUnique({ where: { workspaceId: ctx.workspace.id } }),
  ]);
  const logoUrl = ctx.workspace.logoStorageKey
    ? await storage().signedUrl(ctx.workspace.logoStorageKey)
    : ctx.workspace.logoUrl;
  return (
    <div className="mt-8 min-h-[760px] space-y-4">
        <SettingsSection
          id="workspace-details"
          eyebrow="Brand information"
          title="Workspace details"
          summary={`Identity, locale and timezone · ${timezoneLabel(ctx.workspace.timezone)}`}
          defaultOpen
        >
          <ActionForm action={updateWorkspaceAction.bind(null, slug)} className="space-y-6">
            <Field name="name" label="Name" defaultValue={ctx.workspace.name} required />
            <Field name="slug" label="Workspace URL slug" defaultValue={ctx.workspace.slug} required hint="Lowercase letters, numbers, and hyphens. Existing links change when this changes." />
            <Field name="website" label="Website" type="url" defaultValue={ctx.workspace.website ?? ''} />
            <TextArea name="description" label="Description" rows={4} defaultValue={ctx.workspace.description ?? ''} />
            <div className="grid gap-6 sm:grid-cols-2">
              <Field name="industry" label="Industry" defaultValue={ctx.workspace.industry ?? ''} />
              <Field name="targetAudience" label="Target audience" defaultValue={ctx.workspace.targetAudience ?? ''} />
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <Select
                name="timezone"
                label="Timezone"
                defaultValue={ctx.workspace.timezone}
                hint="Existing publication instants stay fixed. Calendar clock times may display differently after a change."
              >
                {timezoneOptions(ctx.workspace.timezone).map((zone) => <option key={zone} value={zone}>{timezoneLabel(zone)}</option>)}
              </Select>
              <Select name="defaultLanguage" label="Default language" defaultValue={ctx.workspace.defaultLanguage}><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="ro">Romanian</option></Select>
            </div>
            {ctx.can('workspace:update') && <PendingButton type="submit" pendingLabel="Saving workspace">Save workspace</PendingButton>}
          </ActionForm>
        </SettingsSection>

        {ctx.can('brand:update') && (
          <SettingsSection
            id="brand-voice"
            eyebrow="AI context"
            title="Brand voice"
            summary="Voice and writing rules"
          >
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
          </SettingsSection>
        )}

        {ctx.can('workspace:update') && (
          <SettingsSection
            id="posting-defaults"
            eyebrow="Workflow defaults"
            title="Posting and AI"
            summary="Post and AI defaults"
          >
            <ActionForm action={updateWorkspacePreferencesAction.bind(null, slug)} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Select name="defaultPostDestination" label="New post destination" defaultValue={preferences?.defaultPostDestination ?? 'DRAFT'}>
                  <option value="DRAFT">Save as draft</option><option value="QUEUE">Add to queue</option><option value="SCHEDULE">Schedule</option>
                </Select>
                <Field name="defaultPublishHour" label="Default hour" type="number" min={0} max={23} defaultValue={preferences?.defaultPublishHour ?? 9} />
                <Field name="defaultPublishMinute" label="Default minute" type="number" min={0} max={59} defaultValue={preferences?.defaultPublishMinute ?? 0} />
              </div>
              <Field name="defaultHashtags" label="Default hashtags" defaultValue={(preferences?.defaultHashtags ?? []).map((tag) => `#${tag}`).join(', ')} />
              <Field name="defaultCta" label="Default call to action" defaultValue={preferences?.defaultCta ?? ''} />
              <Select name="aiCreativity" label="AI creativity" defaultValue={preferences?.aiCreativity ?? 'BALANCED'}>
                <option value="PRECISE">Precise</option><option value="BALANCED">Balanced</option><option value="CREATIVE">Creative</option>
              </Select>
              <Checkbox name="requireApprovalByDefault" label="Require approval by default" defaultChecked={preferences?.requireApprovalByDefault ?? false} />
              <Checkbox name="aiUseBrandVoice" label="Use brand voice for AI" defaultChecked={preferences?.aiUseBrandVoice ?? true} />
              <Checkbox name="aiAutoAdaptPlatforms" label="Automatically adapt AI copy per platform" defaultChecked={preferences?.aiAutoAdaptPlatforms ?? true} />
              <PendingButton type="submit" pendingLabel="Saving defaults">Save defaults</PendingButton>
            </ActionForm>
          </SettingsSection>
        )}

        {ctx.can('workspace:update') && (
          <SettingsSection
            id="workspace-logo"
            eyebrow="Brand asset"
            title="Workspace logo"
            summary={logoUrl ? 'Logo set' : 'No logo set'}
          >
            <div className="space-y-6">
              {logoUrl && <img src={logoUrl} alt={`${ctx.workspace.name} logo`} className="size-20 rounded-md object-contain" />}
              <ActionForm action={uploadWorkspaceLogoAction.bind(null, slug)} className="space-y-6">
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
            </div>
          </SettingsSection>
        )}

        {ctx.role === 'OWNER' && (
          <SettingsSection
            id="ownership"
            eyebrow="Ownership"
            title="Transfer or delete"
            summary="Transfer or permanently delete"
            tone="ownership"
          >
            <div className="grid gap-4 lg:grid-cols-2">
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
          </SettingsSection>
        )}
      </div>
  );
}
