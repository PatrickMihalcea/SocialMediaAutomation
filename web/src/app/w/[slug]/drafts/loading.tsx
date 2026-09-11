import { ListPagePreview, PageTitle } from '@/components/page-previews';

export default function Loading() {
  return (
    <>
      <PageTitle eyebrow="Posts" title="Drafts" />
      <ListPagePreview label="Loading drafts" />
    </>
  );
}
