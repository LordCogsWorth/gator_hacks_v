/**
 * When this window is in Supabase mode and the health probe fails, offer a one-click
 * switch to offline demo data. No silent fallback — the user chooses.
 */
import { useEffect, useState } from 'react';
import { dataMode, healthCheck, switchToOfflineData } from '../api';
import { Banner } from './Banner';
import { Button } from './Button';

export function SupabaseHealthBanner({ className }: { className?: string }) {
  const [down, setDown] = useState(false);

  useEffect(() => {
    if (dataMode() === 'local') return;
    let cancelled = false;
    healthCheck().then((h) => {
      if (!cancelled && !h.ok) setDown(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!down) return null;

  return (
    <Banner
      tone="danger"
      title="Can't reach Supabase"
      className={className}
      action={
        <Button variant="secondary" onClick={() => switchToOfflineData()}>
          Use offline demo data
        </Button>
      }
    >
      The live database didn't answer. Stay and retry later, or switch this window to the offline demo.
    </Banner>
  );
}
