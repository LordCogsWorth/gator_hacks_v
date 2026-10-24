import { useState, type ReactNode } from 'react';
import { speak, useMuted } from '../voice/useVoice';

/** Every patient screen sits in this: header, mute toggle, and the always-visible 911 link. */
export function Layout({ children }: { children: ReactNode }) {
  const [showSigns, setShowSigns] = useState(false);
  const [muted, setMuted] = useMuted();

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-200 px-4 py-3 sm:px-8">
        <div className="text-2xl font-extrabold text-blue-800">RehabTrack</div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setMuted(!muted)}
            className="min-h-[60px] rounded-2xl border-2 border-slate-400 px-5 text-lg font-bold"
            aria-pressed={!muted}
          >
            {muted ? '🔇 Voice off' : '🔊 Voice on'}
          </button>
          <button
            onClick={() => {
              setShowSigns(true);
              speak('Stroke warning signs. Face drooping, arm weakness, or speech difficulty. Call 9 1 1 now.');
            }}
            className="min-h-[60px] rounded-2xl bg-red-700 px-5 text-lg font-extrabold text-white"
          >
            ⚠ Stroke warning signs — call 911
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-8">{children}</main>
      {showSigns && <WarningSigns onClose={() => setShowSigns(false)} />}
    </div>
  );
}

function WarningSigns({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6">
        <h2 className="text-3xl font-extrabold text-red-700">Call 911 right away if you notice:</h2>
        <ul className="mt-4 space-y-3 text-2xl">
          <li>😶 <b>Face</b> drooping on one side</li>
          <li>💪 <b>Arm</b> suddenly weak or numb</li>
          <li>🗣 <b>Speech</b> slurred or hard to understand</li>
        </ul>
        <p className="mt-4 text-xl">Note the time it started. Do not wait to see if it goes away.</p>
        <p className="mt-2 text-lg text-slate-600">This app cannot detect a stroke.</p>
        <a href="tel:911" className="mt-5 flex min-h-[72px] items-center justify-center rounded-2xl bg-red-700 text-2xl font-extrabold text-white">
          📞 Call 911
        </a>
        <BigButton variant="secondary" className="mt-3 w-full" onClick={onClose}>
          Close
        </BigButton>
      </div>
    </div>
  );
}

export function BigButton({
  children,
  onClick,
  variant = 'primary',
  className = '',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  disabled?: boolean;
}) {
  const styles = {
    primary: 'bg-blue-800 text-white',
    secondary: 'border-2 border-slate-500 bg-white text-slate-950',
    danger: 'bg-red-700 text-white',
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[72px] rounded-2xl px-8 text-2xl font-extrabold disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}
