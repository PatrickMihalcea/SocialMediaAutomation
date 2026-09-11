import { ListPagePreview, PageTitle } from '@/components/page-previews';

export default function Loading() {
  return (
    <>
      <PageTitle eyebrow="Campaign" title="Campaign detail" />
      <ListPagePreview label="Loading campaign" />
    </>
  );
}
