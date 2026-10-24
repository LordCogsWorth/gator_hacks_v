import { Cloud, HardDrive } from 'lucide-react';
import { dataMode } from '../api';
import { Badge } from './Badge';

/** Which data source this window uses: "Offline demo data" (local) or "Live · Supabase". */
export function DataModeBadge({ className }: { className?: string }) {
  const mode = dataMode();
  return mode === 'supabase' ? (
    <Badge tone="success" icon={<Cloud />} className={className} title="Reading and writing the shared Supabase database">
      Live · Supabase
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<HardDrive />} className={className} title="Demo data stored in this browser; works without a network">
      Offline demo data
    </Badge>
  );
}
