import { Phone, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Modal } from './Modal';

const SIGNS: [letter: string, word: string, text: string][] = [
  ['B', 'Balance', 'Sudden loss of balance or dizziness'],
  ['E', 'Eyes', 'Sudden trouble seeing in one or both eyes'],
  ['F', 'Face', 'One side of the face droops'],
  ['A', 'Arm', 'An arm is suddenly weak or numb'],
  ['S', 'Speech', 'Speech is slurred or hard to understand'],
  ['T', 'Time', 'Call 911 right away'],
];

/** What the voice reads when the warning signs open (pass to `onSignsOpen` → speak()). */
export const WARNING_SIGNS_SPEECH =
  'Stroke warning signs. Loss of balance, trouble seeing, face drooping, arm weakness, or speech difficulty. Call 9 1 1 now.';

export interface EmergencyBarProps {
  /** Called when the warning-signs dialog opens (the patient app speaks WARNING_SIGNS_SPEECH). */
  onSignsOpen?: () => void;
  className?: string;
}

/**
 * Always-visible emergency actions for the patient header: a "Call 911" tel: link and a
 * "Stroke warning signs" button that opens the BE-FAST dialog. Both are ≥ var(--tap) tall.
 * On phones the signs button collapses to its icon (it keeps its accessible name).
 */
export function EmergencyBar({ onSignsOpen, className }: EmergencyBarProps) {
  const [open, setOpen] = useState(false);
  const show = () => {
    setOpen(true);
    onSignsOpen?.();
  };
  return (
    <div className={cx('flex shrink-0 items-center gap-2', className)}>
      <Button
        variant="secondary"
        onClick={show}
        icon={<TriangleAlert className="text-danger" />}
        aria-label="Stroke warning signs"
        aria-haspopup="dialog"
        className="px-3 sm:px-4"
      >
        <span className="hidden sm:inline">Stroke warning signs</span>
      </Button>
      <Button variant="danger" href="tel:911" icon={<Phone />} className="whitespace-nowrap px-3 sm:px-4">
        Call 911
      </Button>
      <WarningSignsDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/** The BE-FAST dialog on its own (e.g. for the safety-stop screen). */
export function WarningSignsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} tone="danger" title="Call 911 right away if you notice:">
      <ul className="space-y-2">
        {SIGNS.map(([letter, word, text]) => (
          <li key={letter} className="flex items-center gap-3 text-lg">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-danger-soft font-display text-xl font-bold text-danger"
              aria-hidden
            >
              {letter}
            </span>
            <span>
              <b>{word}:</b> {text}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-lg">Note the time it started. Do not wait to see if it goes away.</p>
      <p className="mt-1 text-base text-text-muted">This app cannot detect a stroke.</p>
      <Button variant="danger" size="xl" href="tel:911" icon={<Phone />} fullWidth className="mt-5">
        Call 911
      </Button>
    </Modal>
  );
}
