import { CalendarPagePreview, PageTitle } from '@/components/page-previews';

export default function Loading() {
  return (
    <>
      <PageTitle eyebrow="Calendar" title="Content calendar" />
      <CalendarPagePreview />
    </>
  );
}
