import { PageTitle, QueuePagePreview } from '@/components/page-previews';

export default function Loading() {
  return (
    <>
      <PageTitle eyebrow="Queue" title="Smart publishing queue" />
      <QueuePagePreview />
    </>
  );
}
