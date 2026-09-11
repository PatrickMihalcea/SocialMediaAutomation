import { PagePreview, Shimmer } from '@/bridge88/preview';

export function PageTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="b88-eyebrow">{eyebrow}</p>
      <h1 className="b88-page-title mt-3">{title}</h1>
    </div>
  );
}

function Line({ className = '' }: { className?: string }) {
  return <Shimmer className={`h-3 ${className}`} />;
}

export function MediaPagePreview() {
  return (
    <PagePreview label="Loading media">
      <div className="mt-6 min-h-[680px]">
        <div className="mb-6 flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Shimmer key={index} className="h-10 w-24 rounded-pill" radius="var(--radius-pill)" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="space-y-3">
              <Shimmer className="aspect-square w-full" radius="8px" />
              <Line className="w-4/5" />
              <Line className="w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </PagePreview>
  );
}

export function CalendarPagePreview() {
  return (
    <PagePreview label="Loading calendar">
      <div className="mt-6 min-h-[680px]">
        <div className="mb-4 flex justify-between gap-4">
          <Line className="mt-2 w-40" />
          <Shimmer className="h-10 w-28 rounded-pill" radius="var(--radius-pill)" />
        </div>
        <div className="mb-3 grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, index) => (
            <Shimmer key={index} className="h-3 w-10" />
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }, (_, index) => (
            <Shimmer key={index} className="min-h-[88px] w-full" radius="8px" />
          ))}
        </div>
      </div>
    </PagePreview>
  );
}

export function AnalyticsPagePreview() {
  return (
    <PagePreview label="Loading analytics">
      <div className="mt-6 min-h-[480px]">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="b88-card space-y-4">
              <Line className="w-24" />
              <Shimmer className="h-10 w-20" />
              <Line className="w-16" />
            </div>
          ))}
        </div>
        <div className="b88-card mt-6 space-y-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 border-t border-hairline-soft pt-4 first:border-0 first:pt-0">
              <Shimmer className="size-11 shrink-0" radius="8px" />
              <div className="min-w-0 flex-1 space-y-2">
                <Line className="w-3/5" />
                <Line className="w-1/3" />
              </div>
              <Line className="w-12" />
            </div>
          ))}
        </div>
      </div>
    </PagePreview>
  );
}

export function QueuePagePreview() {
  return (
    <PagePreview label="Loading queue">
      <div className="mt-6 min-h-[680px] space-y-3">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="b88-card flex items-center gap-4">
            <Shimmer className="h-10 w-16" />
            <div className="min-w-0 flex-1 space-y-2">
              <Line className="w-2/3" />
              <Line className="w-1/3" />
            </div>
            <Shimmer className="h-10 w-24 rounded-pill" radius="var(--radius-pill)" />
          </div>
        ))}
      </div>
    </PagePreview>
  );
}

export function CampaignsPagePreview() {
  return (
    <PagePreview label="Loading campaigns">
      <div className="mt-6 grid min-h-[420px] gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="b88-card space-y-4">
            <Shimmer className="h-16 w-full" radius="8px" />
            <Line className="w-3/4" />
            <Line className="w-1/2" />
          </div>
        ))}
      </div>
    </PagePreview>
  );
}

export function HistoryPagePreview() {
  return (
    <PagePreview label="Loading history">
      <div className="mt-6 min-h-[460px] max-w-5xl space-y-0">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-hairline-soft py-3 first:border-0">
            <Shimmer className="h-6 w-20" radius="6px" />
            <Line className="w-4/5" />
            <Line className="w-24" />
          </div>
        ))}
      </div>
    </PagePreview>
  );
}

export function TeamPagePreview() {
  return (
    <PagePreview label="Loading team">
      <div className="mt-6 min-h-[420px] space-y-3">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="b88-card flex items-center gap-4">
            <Shimmer className="size-10 shrink-0 rounded-full" radius="9999px" />
            <div className="min-w-0 flex-1 space-y-2">
              <Line className="w-40" />
              <Line className="w-24" />
            </div>
            <Shimmer className="h-10 w-28 rounded-pill" radius="var(--radius-pill)" />
          </div>
        ))}
      </div>
    </PagePreview>
  );
}

export function SettingsPagePreview() {
  return (
    <PagePreview label="Loading settings">
      <div className="mt-8 min-h-[760px] space-y-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="b88-card space-y-4">
            <Line className="w-32" />
            <Shimmer className="h-12 w-full" radius="8px" />
            <Shimmer className="h-12 w-full" radius="8px" />
          </div>
        ))}
      </div>
    </PagePreview>
  );
}

export function AssistantPagePreview() {
  return (
    <PagePreview label="Loading assistant">
      <div className="grid min-h-[520px] gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Shimmer key={index} className="h-10 w-full" radius="8px" />
          ))}
        </div>
        <div className="b88-card flex min-h-[480px] flex-col justify-end gap-3">
          <Line className="w-2/3" />
          <Line className="ml-auto w-1/2" />
          <Line className="w-3/5" />
          <Shimmer className="mt-auto h-12 w-full" radius="8px" />
        </div>
      </div>
    </PagePreview>
  );
}

export function ChannelsPagePreview() {
  return (
    <PagePreview label="Loading social accounts">
      <div className="mt-6 grid min-h-[420px] gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="b88-card space-y-4">
            <div className="flex items-center gap-3">
              <Shimmer className="size-10 shrink-0 rounded-full" radius="9999px" />
              <div className="flex-1 space-y-2">
                <Line className="w-2/3" />
                <Line className="w-1/3" />
              </div>
            </div>
            <Shimmer className="h-10 w-32 rounded-pill" radius="var(--radius-pill)" />
          </div>
        ))}
      </div>
    </PagePreview>
  );
}

export function DashboardPagePreview() {
  return (
    <PagePreview label="Loading dashboard">
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="b88-card space-y-4">
            <Line className="w-28" />
            <Shimmer className="h-10 w-16" />
          </div>
        ))}
      </div>
      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,.8fr)]">
        <div className="b88-card space-y-4">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-4">
              <Shimmer className="size-11 shrink-0" radius="8px" />
              <div className="min-w-0 flex-1 space-y-2">
                <Line className="w-3/5" />
                <Line className="w-1/3" />
              </div>
            </div>
          ))}
        </div>
        <Shimmer className="min-h-[280px] w-full" radius="24px" />
      </div>
    </PagePreview>
  );
}

export function StudioPagePreview() {
  return (
    <PagePreview label="Loading AI studio">
      <div className="mt-6 grid min-h-[520px] gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="b88-card space-y-4">
          <Shimmer className="h-12 w-full" radius="8px" />
          <Shimmer className="h-40 w-full" radius="8px" />
          <Shimmer className="h-10 w-36 rounded-pill" radius="var(--radius-pill)" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Shimmer key={index} className="aspect-square w-full" radius="8px" />
          ))}
        </div>
      </div>
    </PagePreview>
  );
}

export function ListPagePreview({ label }: { label: string }) {
  return (
    <PagePreview label={label}>
      <div className="mt-6 min-h-[420px] space-y-0">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 border-t border-hairline-soft py-4 first:border-0">
            <Shimmer className="size-11 shrink-0" radius="8px" />
            <div className="min-w-0 flex-1 space-y-2">
              <Line className="w-3/5" />
              <Line className="w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </PagePreview>
  );
}

export function ComposerPagePreview() {
  return (
    <PagePreview label="Loading composer">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
        <div className="b88-card space-y-5">
          <Shimmer className="h-12 w-full" radius="8px" />
          <Shimmer className="h-12 w-full" radius="8px" />
          <Shimmer className="h-40 w-full" radius="8px" />
        </div>
        <div className="b88-card space-y-4">
          <Shimmer className="aspect-square w-full" radius="8px" />
          <Line className="w-2/3" />
        </div>
      </div>
    </PagePreview>
  );
}

export function AdminPagePreview() {
  return (
    <PagePreview label="Loading admin">
      <div className="mt-8 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="b88-card space-y-3">
            <Line className="w-20" />
            <Shimmer className="h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="b88-card mt-8 space-y-4">
        {Array.from({ length: 6 }, (_, index) => (
          <Line key={index} className="w-full" />
        ))}
      </div>
    </PagePreview>
  );
}

export function GenericPagePreview() {
  return (
    <PagePreview label="Loading page">
      <Shimmer className="h-4 w-28" />
      <Shimmer className="mt-3 h-12 w-72 max-w-full" />
      <DashboardPagePreview />
    </PagePreview>
  );
}
