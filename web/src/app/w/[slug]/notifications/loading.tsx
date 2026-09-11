import { ListPagePreview, PageTitle } from '@/components/page-previews';

export default function Loading() {
  return (
    <>
      <PageTitle eyebrow="Inbox" title="Notifications" />
      <ListPagePreview label="Loading notifications" />
    </>
  );
}
