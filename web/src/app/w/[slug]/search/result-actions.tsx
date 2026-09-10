'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/bridge88/components';
import { deleteSearchPostAction, duplicateSearchPostAction } from './actions';

export function PostResultActions({ slug, postId, canEdit, canDelete }: {
  slug: string;
  postId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}>
      <Button href={`/w/${slug}/posts/${postId}`} variant="tertiary">Open</Button>
      {canEdit && <Button href={`/w/${slug}/compose/${postId}`} variant="tertiary">Edit</Button>}
      {canEdit && <form action={duplicateSearchPostAction.bind(null, slug, postId)}><SubmitButton idle="Duplicate" pending="Duplicating" /></form>}
      {canDelete && (
        <form
          action={deleteSearchPostAction.bind(null, slug, postId)}
          onSubmit={(event) => {
            if (!window.confirm('Delete this post? This cannot be undone.')) event.preventDefault();
          }}
        >
          <SubmitButton idle="Delete" pending="Deleting" />
        </form>
      )}
    </div>
  );
}

function SubmitButton({ idle, pending }: { idle: string; pending: string }) {
  const status = useFormStatus();
  return <Button type="submit" variant="tertiary" disabled={status.pending} className="min-w-[92px]">{status.pending ? pending : idle}</Button>;
}
