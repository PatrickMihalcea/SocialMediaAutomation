import { ListPagePreview, PageTitle } from '@/components/page-previews';

export default function Loading() {
  return (
    <>
      <PageTitle eyebrow="Workspace search" title="Find anything" />
      <ListPagePreview label="Loading search" />
    </>
  );
}
