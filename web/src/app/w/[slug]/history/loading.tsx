import { HistoryPagePreview, PageTitle } from '@/components/page-previews';

export default function Loading() {
  return (
    <>
      <PageTitle eyebrow="Workspace activity" title="History" />
      <HistoryPagePreview />
    </>
  );
}
