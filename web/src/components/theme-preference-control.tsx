'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SegmentedTabs } from '@/bridge88/components';
import { updateThemePreferenceAction } from '@/app/actions/auth';

export type ThemePreference = 'LIGHT' | 'DARK';

const labels: Record<ThemePreference, string> = { LIGHT: 'Light', DARK: 'Dark' };

export function ThemePreferenceControl({
  initialPreference,
}: {
  initialPreference: ThemePreference;
}) {
  const router = useRouter();
  const [preference, setPreference] = useState(initialPreference);
  const [saveFailed, setSaveFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function apply(next: ThemePreference) {
    document.documentElement.dataset.theme = next === 'DARK' ? 'dark' : 'light';
  }

  function select(label: string) {
    const next: ThemePreference = label === labels.DARK ? 'DARK' : 'LIGHT';
    if (next === preference) return;
    const previous = preference;
    setSaveFailed(false);
    setPreference(next);
    apply(next);

    startTransition(async () => {
      const formData = new FormData();
      formData.set('themePreference', next);
      try {
        await updateThemePreferenceAction(formData);
        router.refresh();
      } catch {
        setPreference(previous);
        setSaveFailed(true);
        apply(previous);
      }
    });
  }

  return (
    <div className="space-y-3">
      <SegmentedTabs
        variant="setting"
        aria-label="Theme"
        aria-busy={isPending}
        items={[labels.LIGHT, labels.DARK]}
        value={labels[preference]}
        onChange={select}
      />
      {saveFailed && (
        <p role="alert" className="text-sm">
          The theme could not be saved. Your previous setting was restored.
        </p>
      )}
      <noscript>
        <form action={updateThemePreferenceAction} className="space-y-3">
          <label className="block">
            <span className="b88-label">Theme</span>
            <select name="themePreference" defaultValue={initialPreference} className="b88-input">
              <option value="LIGHT">Light</option>
              <option value="DARK">Dark</option>
            </select>
          </label>
          <button type="submit" className="h-10 rounded-pill border border-[var(--hairline)] bg-[var(--canvas)] px-4 font-[480]">
            Save theme
          </button>
        </form>
      </noscript>
    </div>
  );
}
