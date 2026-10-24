import { Pause, Play, RotateCcw } from 'lucide-react';
import { useId } from 'react';
import type { ReplayFile } from '../../types';
import { Button } from '../../ui/Button';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { formatTime, warningRuns } from './replayMath';

export const SPEEDS = [0.5, 1] as const;
export type Speed = (typeof SPEEDS)[number];

export interface ReplayControlsProps {
  frame: number;
  frameCount: number;
  fps: number;
  playing: boolean;
  speed: Speed;
  warnings: ReplayFile['warnings'];
  onPlayPause: () => void;
  onSpeed: (s: Speed) => void;
  onSeek: (frame: number) => void;
}

export function ReplayControls({ frame, frameCount, fps, playing, speed, warnings, onPlayPause, onSpeed, onSeek }: ReplayControlsProps) {
  const id = useId();
  const last = Math.max(0, frameCount - 1);
  const atEnd = frame >= last;
  const runs = warningRuns(warnings);
  const pct = (f: number) => (last ? (f / last) * 100 : 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={onPlayPause}
          icon={playing ? <Pause /> : atEnd ? <RotateCcw /> : <Play />}
          aria-label={playing ? 'Pause' : atEnd ? 'Replay from the start' : 'Play'}
          className="min-w-[7.5rem]"
        >
          {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
        </Button>
        <SegmentedControl<string>
          label="Playback speed"
          value={String(speed)}
          onChange={(v) => onSpeed(Number(v) as Speed)}
          options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
        />
        <p className="ml-auto text-base tabular-nums text-text-muted" aria-live="off">
          <span className="font-semibold text-text">{formatTime(frame, fps)}</span> / {formatTime(last, fps)}
          <span className="ml-2">
            · frame {frame + 1} of {frameCount}
          </span>
        </p>
      </div>

      <div className="relative pb-3">
        <label htmlFor={id} className="sr-only">
          Replay position
        </label>
        <input
          id={id}
          type="range"
          min={0}
          max={last}
          step={1}
          value={frame}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-valuetext={`${formatTime(frame, fps)} of ${formatTime(last, fps)}`}
          className="block h-tap w-full cursor-pointer accent-[rgb(var(--primary))]"
        />
        <div className="pointer-events-none absolute inset-x-2 bottom-0 h-2" aria-hidden>
          {runs.map((r) => (
            <span
              key={r.start}
              className="absolute top-0 h-2 rounded-full bg-danger"
              style={{ left: `${pct(r.start)}%`, width: `max(4px, ${pct(r.end) - pct(r.start)}%)` }}
            />
          ))}
        </div>
      </div>
      {runs.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <span className="inline-block h-2 w-5 rounded-full bg-danger" aria-hidden />
          Red marks under the bar: moments with a compensation warning ({runs.length}).
        </p>
      )}
    </div>
  );
}
