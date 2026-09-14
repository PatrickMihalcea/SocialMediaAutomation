'use client';

import { useEffect, useState } from 'react';
import { timezoneLabel } from '@/lib/scheduling/time';

/**
 * The server cannot know the browser zone, so the first client render must
 * repeat the server placeholder and the real zone is resolved after mount.
 * Nothing is posted until then — without JavaScript the field stays absent and
 * the workspace schema applies its UTC default.
 */
export function DetectedTimezone() {
  const [timezone, setTimezone] = useState('');
  useEffect(() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''), []);
  return (
    <div>
      <p className="b88-label">Timezone</p>
      <p className="mt-1.5">{timezone ? timezoneLabel(timezone) : 'Detecting…'}</p>
      <p className="b88-caption mt-1">Change it in settings.</p>
      {timezone && <input type="hidden" name="timezone" value={timezone} />}
    </div>
  );
}
