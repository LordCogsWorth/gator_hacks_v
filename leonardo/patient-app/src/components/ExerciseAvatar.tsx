// A small coach figure that acts out the exercise, with a speech bubble that reads out the steps.
import { Play, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ExerciseInfo } from '../data/exercises';
import type { ExerciseId } from '../types';
import { speakLines } from '../voice/useVoice';
import { BigButton } from './Layout';

const SKIN = '#d4d4d4';
const SHIRT = '#737373';
const PANTS = '#404040';
const CHAIR = '#262626';
const LINE = '#a3a3a3';

export function ExerciseExplainer({ info, onStart }: { info: ExerciseInfo; onStart: () => void }) {
  const [current, setCurrent] = useState(-1);
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    setCurrent(-1);
    speakLines(
      [`Let me show you: ${info.title}.`, ...info.steps, 'We will do your stronger arm first, then your weaker arm.'],
      (i) => setCurrent(i - 1),
    );
  }, [info, replay]);

  return (
    <div className="space-y-5">
      <div className="grid items-center gap-5 md:grid-cols-[minmax(0,340px)_1fr]">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <Avatar exercise={info.id} />
          <div className="text-center text-lg font-medium text-neutral-400">Your coach</div>
        </div>

        {/* Speech bubble, with a tail pointing at the coach on wide screens. */}
        <div className="relative rounded-2xl border border-neutral-700 bg-neutral-900 p-6">
          <span
            className="absolute -left-[12px] top-1/2 hidden h-6 w-6 -translate-y-1/2 rotate-45 border-b border-l border-neutral-700 bg-neutral-900 md:block"
            aria-hidden
          />
          <h2 className="text-2xl font-semibold">{info.title}</h2>
          <StepList steps={info.steps} current={current} />
          <p className="mt-4 text-lg text-neutral-400">Stronger arm first, then your weaker arm.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <BigButton onClick={onStart}>
          <Play className="h-5 w-5" /> I'm ready, let's start
        </BigButton>
        <BigButton variant="secondary" onClick={() => setReplay((r) => r + 1)}>
          <RotateCcw className="h-5 w-5" /> Explain again
        </BigButton>
      </div>
    </div>
  );
}

export function Avatar({ exercise }: { exercise: ExerciseId }) {
  return (
    <svg viewBox="0 0 300 300" className="mx-auto w-full max-w-[300px]" role="img" aria-label={`Coach showing the ${exercise.replace('_', ' ')} exercise`}>
      {exercise === 'arm_raise' && <ArmRaise />}
      {exercise === 'forward_reach' && <ForwardReach />}
      {exercise === 'hand_open' && <HandOpen />}
    </svg>
  );
}

/** Numbered steps; the one being read aloud is highlighted. */
export function StepList({ steps, current = -1 }: { steps: string[]; current?: number }) {
  return (
    <ol className="mt-4 space-y-2">
      {steps.map((s, i) => (
        <li key={s} className={`flex gap-3 rounded-xl p-2 text-xl transition-colors ${current === i ? 'bg-neutral-100 text-neutral-950' : ''}`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-current text-lg font-semibold">{i + 1}</span>
          <span className="pt-0.5">{s}</span>
        </li>
      ))}
    </ol>
  );
}

function Face({ cx, cy, side = false }: { cx: number; cy: number; side?: boolean }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={28} fill={SKIN} />
      {side ? (
        <>
          <circle cx={cx + 12} cy={cy - 4} r={3.5} fill="#0a0a0a" />
          <path d={`M${cx + 8} ${cy + 12} q8 5 14 -2`} stroke="#0a0a0a" strokeWidth={3} fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx={cx - 10} cy={cy - 4} r={3.5} fill="#0a0a0a" />
          <circle cx={cx + 10} cy={cy - 4} r={3.5} fill="#0a0a0a" />
          <path d={`M${cx - 11} ${cy + 9} q11 10 22 0`} stroke="#0a0a0a" strokeWidth={3} fill="none" strokeLinecap="round" />
        </>
      )}
    </g>
  );
}

/** Front view: one arm sweeps out to the side and back down. */
function ArmRaise() {
  return (
    <g>
      <rect x={95} y={95} width={110} height={110} rx={10} fill={CHAIR} />
      <rect x={85} y={195} width={130} height={16} rx={6} fill={CHAIR} />
      <rect x={122} y={200} width={22} height={75} rx={10} fill={PANTS} />
      <rect x={156} y={200} width={22} height={75} rx={10} fill={PANTS} />
      <rect x={116} y={100} width={68} height={105} rx={18} fill={SHIRT} />
      <rect x={104} y={104} width={18} height={84} rx={9} fill={SHIRT} />
      {/* Motion path */}
      <path d="M190 200 A88 88 0 0 0 278 112" fill="none" stroke={LINE} strokeWidth={3} strokeDasharray="6 8" />
      <path d="M272 100 l8 13 l-14 2 z" fill={LINE} />
      <g className="coach-raise" style={{ transformOrigin: '186px 110px' }}>
        <rect x={177} y={104} width={18} height={84} rx={9} fill={SHIRT} />
        <circle cx={186} cy={192} r={10} fill={SKIN} />
      </g>
      <Face cx={150} cy={68} />
    </g>
  );
}

/** Side view: elbow starts bent, then the arm reaches straight forward toward a cup. */
function ForwardReach() {
  return (
    <g>
      <rect x={78} y={90} width={16} height={120} rx={6} fill={CHAIR} />
      <rect x={78} y={196} width={110} height={14} rx={6} fill={CHAIR} />
      <rect x={110} y={184} width={100} height={22} rx={11} fill={PANTS} />
      <rect x={190} y={190} width={22} height={85} rx={10} fill={PANTS} />
      <rect x={100} y={100} width={46} height={100} rx={18} fill={SHIRT} />
      {/* Cup to reach for */}
      <path d="M248 100 h26 l-4 34 h-18 z" fill={LINE} />
      <path d="M210 112 h28" stroke={LINE} strokeWidth={3} strokeDasharray="6 8" />
      <g className="coach-reach-upper" style={{ transformOrigin: '124px 112px' }}>
        <rect x={115} y={104} width={18} height={60} rx={9} fill={SHIRT} />
        <g className="coach-reach-fore" style={{ transformOrigin: '124px 160px' }}>
          <rect x={116} y={156} width={16} height={58} rx={8} fill={SKIN} />
          <circle cx={124} cy={216} r={10} fill={SKIN} />
        </g>
      </g>
      <Face cx={130} cy={68} side />
    </g>
  );
}

/** Close-up of a palm: fingers curl into a fist and open wide. */
function HandOpen() {
  const fingers = [
    { x: 104, h: 62 },
    { x: 128, h: 76 },
    { x: 152, h: 80 },
    { x: 176, h: 70 },
  ];
  return (
    <g>
      {fingers.map((f, i) => (
        <rect
          key={i}
          className="coach-finger"
          style={{ transformOrigin: `${f.x + 10}px 150px` }}
          x={f.x}
          y={150 - f.h}
          width={20}
          height={f.h + 14}
          rx={10}
          fill={SKIN}
        />
      ))}
      <rect x={98} y={140} width={104} height={100} rx={30} fill={SKIN} />
      <g className="coach-thumb" style={{ transformOrigin: '110px 200px' }}>
        <rect x={60} y={170} width={56} height={22} rx={11} fill={SKIN} transform="rotate(-30 110 200)" />
      </g>
      <rect x={118} y={236} width={64} height={50} rx={10} fill={SHIRT} />
      <path d="M150 40 v-20 M124 46 l-10 -16 M176 46 l10 -16" stroke={LINE} strokeWidth={4} strokeLinecap="round" className="coach-spark" />
    </g>
  );
}
