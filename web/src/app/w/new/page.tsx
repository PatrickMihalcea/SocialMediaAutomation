import Link from 'next/link';
import { Field, MediaUploader, TextArea } from '@/bridge88/components';
import { createWorkspaceAction } from '@/app/actions/workspace';
import { ActionForm } from '@/components/action-form';
import { PendingButton } from '@/components/action-ui';
import { DetectedTimezone } from '@/components/detected-timezone';
import { requireUser } from '@/lib/auth/guard';

export const metadata = { title: 'New workspace' };

export default async function NewWorkspacePage() {
  await requireUser();
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-14" tabIndex={-1}>
      <Link href="/w" className="text-xl font-[540]">Bridge88</Link>
      <p className="b88-eyebrow mt-14">New workspace</p>
      <h1 className="b88-page-title mt-3">Create another workspace.</h1>
      <ActionForm action={createWorkspaceAction} className="b88-card mt-8 grid gap-5">
        <Field name="name" label="Workspace name" required />
        <Field name="website" label="Website" type="url" placeholder="https://" />
        <TextArea name="description" label="What does the business do?" rows={4} required />
        <Field name="industry" label="Industry" />
        <Field name="targetAudience" label="Target audience" />
        <DetectedTimezone />
        <div>
          <p className="b88-label">Workspace logo</p>
          <MediaUploader
            name="logo"
            title="Drop your logo here"
            hint="JPG, PNG, or WebP · up to 2 MB"
            accept="image/jpeg,image/png,image/webp"
            multiple={false}
            compact
          />
        </div>
        <input type="hidden" name="defaultLanguage" value="en" />
        <div className="flex justify-end"><PendingButton type="submit" className="w-full sm:w-auto" pendingLabel="Creating workspace">Create workspace</PendingButton></div>
      </ActionForm>
    </main>
  );
}
