/**
 * 3D session replay: /care/patients/:id/sessions/:sid?exercise=arm_raise&side=weak|healthy|both
 * (CONVERGENCE_PLAN §8). Lazy-loaded by App.tsx, so three.js only downloads with this page.
 */
import { Box, Hand, MousePointerClick, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getPatient, getSessionReplay, getSessionReplays } from '../../api';
import type { Exercise, Patient, ReplayFile, ReplaySummary, Side } from '../../types';
import { EXERCISE_LABELS } from '../../types';
import { Badge } from '../../ui/Badge';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Spinner } from '../../ui/Spinner';
import { AngleChart } from './AngleChart';
import { ReplayControls, type Speed } from './ReplayControls';
import { angleSeries, armJoints, bodySideFor, frameAngles, warningMask, warningRuns } from './replayMath';
import SkeletonScene from './SkeletonScene';

type ViewSide = Side | 'both';

const EXERCISE_ORDER: Exercise[] = ['arm_raise', 'forward_reach', 'hand_open'];
const VIEW_SIDES: { value: ViewSide; label: string }[] = [
  { value: 'healthy', label: 'Healthy' },
  { value: 'weak', label: 'Weak' },
  { value: 'both', label: 'Both' },
];

const ANGLE_LABELS: Record<Exercise, string | null> = {
  arm_raise: 'Arm raise (hip–shoulder–elbow)',
  forward_reach: 'Elbow straightening (shoulder–elbow–wrist)',
  hand_open: null,
};

const WARNING_LABELS: Record<string, string> = { lean: 'Trunk lean', shoulder_hike: 'Shoulder hike' };

const isExercise = (v: string | null): v is Exercise => !!v && (EXERCISE_ORDER as string[]).includes(v);
const isViewSide = (v: string | null): v is ViewSide => v === 'weak' || v === 'healthy' || v === 'both';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function ReplayPage() {
  const { id = '', sid = '' } = useParams<{ id: string; sid: string }>();
  const [params, setParams] = useSearchParams();

  const [summaries, setSummaries] = useState<ReplaySummary[] | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setSummaries(null);
    setLoadError(null);
    Promise.all([getSessionReplays(sid), getPatient(id)])
      .then(([list, detail]) => {
        if (!live) return;
        setSummaries(list);
        setPatient(detail.patient);
      })
      .catch((e) => live && setLoadError(errorText(e)));
    return () => {
      live = false;
    };
  }, [id, sid, attempt]);

  const available = useMemo(() => {
    const m = new Map<Exercise, Set<Side>>();
    for (const s of summaries ?? []) {
      if (!m.has(s.exercise)) m.set(s.exercise, new Set());
      m.get(s.exercise)!.add(s.side);
    }
    return m;
  }, [summaries]);

  // Resolve the URL's choice against what was recorded.
  const qEx = params.get('exercise');
  const qSide = params.get('side');
  const exercises = EXERCISE_ORDER.filter((e) => available.has(e));
  const exercise: Exercise | null = isExercise(qEx) && available.has(qEx) ? qEx : (exercises[0] ?? null);
  const sides = exercise ? available.get(exercise)! : new Set<Side>();
  const canBoth = sides.has('weak') && sides.has('healthy');
  const wanted: ViewSide = isViewSide(qSide) ? qSide : 'weak';
  const viewSide: ViewSide | null = !exercise
    ? null
    : wanted === 'both'
      ? canBoth
        ? 'both'
        : sides.has('weak')
          ? 'weak'
          : 'healthy'
      : sides.has(wanted)
        ? wanted
        : sides.has('weak')
          ? 'weak'
          : 'healthy';

  useEffect(() => {
    if (!exercise || !viewSide) return;
    if (qEx !== exercise || qSide !== viewSide) setParams({ exercise, side: viewSide }, { replace: true });
  }, [exercise, viewSide, qEx, qSide, setParams]);

  const choose = (ex: Exercise, side: ViewSide) => setParams({ exercise: ex, side }, { replace: true });

  // Replay files, cached by session + exercise + side.
  const [files, setFiles] = useState<Record<string, ReplayFile>>({});
  const filesRef = useRef(files);
  filesRef.current = files;
  const [fileError, setFileError] = useState<string | null>(null);
  const fileKey = (ex: Exercise, side: Side) => `${sid}|${ex}|${side}`;
  const needed: Side[] = viewSide === 'both' ? ['weak', 'healthy'] : viewSide ? [viewSide] : [];
  const neededKey = needed.join(',');
  useEffect(() => {
    if (!exercise || !neededKey) return;
    let live = true;
    setFileError(null);
    const missing = (neededKey.split(',') as Side[]).filter((s) => !filesRef.current[`${sid}|${exercise}|${s}`]);
    if (!missing.length) return;
    Promise.all(missing.map((s) => getSessionReplay(sid, exercise, s).then((f) => [`${sid}|${exercise}|${s}`, f] as const)))
      .then((got) => live && setFiles((prev) => ({ ...prev, ...Object.fromEntries(got) })))
      .catch((e) => live && setFileError(errorText(e)));
    return () => {
      live = false;
    };
  }, [sid, exercise, neededKey, attempt]);

  const mainSide: Side | null = viewSide === 'both' ? 'weak' : viewSide;
  const main = exercise && mainSide ? (files[fileKey(exercise, mainSide)] ?? null) : null;
  const ghost = exercise && viewSide === 'both' ? (files[fileKey(exercise, 'healthy')] ?? null) : null;
  const ready = !!main && (viewSide !== 'both' || !!ghost);
  const shownSummary = summaries?.find((s) => s.exercise === exercise && s.side === mainSide) ?? summaries?.[0];

  const header = (
    <PageHeader
      back={{ to: `/care/patients/${encodeURIComponent(id)}`, label: patient ? `Back to ${patient.name}` : 'Back to patient' }}
      title="Session replay"
      subtitle={patient ? `${patient.name} · weak side ${patient.weakSide}` : undefined}
      meta={
        shownSummary ? (
          <span className="text-base text-text-muted">Recorded {new Date(shownSummary.uploadedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        ) : undefined
      }
    />
  );

  if (loadError) {
    return (
      <div>
        {header}
        <Banner
          tone="danger"
          title="Couldn't load this session's replays"
          action={
            <Button variant="secondary" icon={<RefreshCw />} onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </Button>
          }
        >
          {loadError}
        </Banner>
      </div>
    );
  }
  if (!summaries || !patient) {
    return (
      <div>
        {header}
        <Spinner label="Loading replay…" className="text-text-muted" />
      </div>
    );
  }
  if (!exercise || !viewSide) {
    return (
      <div>
        {header}
        <EmptyState icon={<Box />} title="No 3D replay for this session">
          Replays are recorded during camera sessions for each exercise and arm. This session has none.
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <SegmentedControl<Exercise>
          label="Exercise"
          value={exercise}
          onChange={(ex) => choose(ex, viewSide)}
          options={EXERCISE_ORDER.map((e) => ({ value: e, label: EXERCISE_LABELS[e], disabled: !available.has(e) }))}
        />
        <SegmentedControl<ViewSide>
          label="Arm"
          value={viewSide}
          onChange={(s) => choose(exercise, s)}
          options={VIEW_SIDES.map((o) => ({ ...o, disabled: o.value === 'both' ? !canBoth : !sides.has(o.value) }))}
        />
      </div>

      {fileError ? (
        <Banner
          tone="danger"
          title="Couldn't load this replay"
          action={
            <Button variant="secondary" icon={<RefreshCw />} onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </Button>
          }
        >
          {fileError}
        </Banner>
      ) : !ready || !main ? (
        <Spinner label="Loading replay…" className="text-text-muted" />
      ) : (
        <ReplayView key={`${sid}-${exercise}-${viewSide}`} exercise={exercise} viewSide={viewSide} main={main} ghost={ghost} patient={patient} />
      )}
    </div>
  );
}

interface ReplayViewProps {
  exercise: Exercise;
  viewSide: ViewSide;
  main: ReplayFile;
  ghost: ReplayFile | null;
  patient: Patient;
}

function ReplayView({ exercise, viewSide, main, ghost, patient }: ReplayViewProps) {
  const mainBody = bodySideFor(main.side, patient.weakSide);
  const ghostBody = ghost ? bodySideFor(ghost.side, patient.weakSide) : null;
  const frameCount = Math.max(main.frames.length, ghost?.frames.length ?? 0);
  const fps = main.fps;

  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [speed, setSpeed] = useState<Speed>(1);
  const frameRef = useRef(0);

  const rows = useMemo(() => angleSeries(main, mainBody), [main, mainBody]);
  const ghostRows = useMemo(() => (ghost && ghostBody ? angleSeries(ghost, ghostBody) : null), [ghost, ghostBody]);
  const mask = useMemo(() => warningMask(main.frames.length, main.warnings), [main]);
  const runs = useMemo(() => warningRuns(main.warnings), [main]);
  const activeJoints = useMemo(() => armJoints(mainBody), [mainBody]);
  const ghostActiveJoints = useMemo(() => (ghostBody ? armJoints(ghostBody) : []), [ghostBody]);

  const seek = useCallback(
    (f: number) => {
      const i = Math.max(0, Math.min(frameCount - 1, Math.round(f)));
      frameRef.current = i;
      setFrame(i);
    },
    [frameCount],
  );
  const onEnd = useCallback(() => setPlaying(false), []);
  const playPause = () => {
    if (!playing && frame >= frameCount - 1) seek(0);
    setPlaying((p) => !p);
  };

  const shown = Math.min(frame, main.frames.length - 1);
  const now = frameAngles(main.frames[shown], exercise, mainBody);
  const ghostNow = ghost && ghostBody ? frameAngles(ghost.frames[Math.min(frame, ghost.frames.length - 1)], exercise, ghostBody) : null;
  const nearTypes = [...new Set((main.warnings ?? []).filter((w) => Math.abs(w.frame - shown) <= 3).map((w) => w.type))];
  const angleLabel = ANGLE_LABELS[exercise];
  const sideWord = (s: Side) => (s === 'weak' ? 'Weak' : 'Healthy');

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card padding="none" className="overflow-hidden">
          <div className="relative h-[380px] sm:h-[460px]">
            <SkeletonScene
              replay={main}
              ghost={ghost}
              activeJoints={activeJoints}
              ghostActiveJoints={ghostActiveJoints}
              warnMask={mask}
              frameRef={frameRef}
              frameCount={frameCount}
              playing={playing}
              speed={speed}
              onFrame={setFrame}
              onEnd={onEnd}
              label={`3D stick figure of the ${mainBody} arm doing ${EXERCISE_LABELS[exercise].toLowerCase()}${ghost ? `, with the ${ghostBody} arm overlaid faintly` : ''}. Drag to rotate, scroll to zoom.`}
            />
            {mask[shown] && (
              <div className="pointer-events-none absolute left-3 top-3">
                <Badge tone="danger" dot>
                  {nearTypes.map((t) => WARNING_LABELS[t] ?? t).join(' + ') || 'Warning'}
                </Badge>
              </div>
            )}
            <p className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-1 text-sm text-text-muted">
              <MousePointerClick className="h-4 w-4" aria-hidden />
              Drag to rotate · scroll to zoom
            </p>
          </div>
          <div className="border-t border-border p-4 sm:p-5">
            <ReplayControls
              frame={frame}
              frameCount={frameCount}
              fps={fps}
              playing={playing}
              speed={speed}
              warnings={main.warnings}
              onPlayPause={playPause}
              onSpeed={setSpeed}
              onSeek={(f) => {
                setPlaying(false);
                seek(f);
              }}
            />
          </div>
        </Card>

        <Card title="At this moment" subtitle={`${sideWord(main.side)} arm (${mainBody})${ghost ? ` · healthy arm (${ghostBody}) faint` : ''}`}>
          <dl className="grid grid-cols-2 gap-4">
            {angleLabel && (
              <div className="col-span-2">
                <dt className="text-sm text-text-muted">{angleLabel}</dt>
                <dd className="font-display text-4xl font-semibold tabular-nums text-text">
                  {now.angle === null ? '—' : `${Math.round(now.angle)}°`}
                  {ghostNow && ghostNow.angle !== null && (
                    <span className="ml-3 text-xl font-medium text-text-muted">healthy {Math.round(ghostNow.angle)}°</span>
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-sm text-text-muted">Trunk lean</dt>
              <dd className="font-display text-3xl font-semibold tabular-nums text-text">{Math.round(now.lean)}°</dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">Warnings</dt>
              <dd className="font-display text-3xl font-semibold tabular-nums text-text">{runs.length}</dd>
            </div>
          </dl>
          {exercise === 'hand_open' && (
            <p className="mt-4 flex gap-2 rounded-control bg-surface-2 p-3 text-base text-text">
              <Hand className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" aria-hidden />
              The replay records arm and body joints only, not the fingers, so hand opening itself isn't shown. Use it to check posture and trunk lean.
            </p>
          )}
          {runs.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {runs.map((r) => (
                <li key={r.start}>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      seek(r.start);
                    }}
                    className="flex min-h-tap w-full items-center justify-between gap-3 rounded-control border border-danger/40 bg-danger-soft px-3 text-left text-base text-text hover:border-danger"
                  >
                    <span>{[...r.types].map((t) => WARNING_LABELS[t] ?? t).join(' + ')}</span>
                    <span className="tabular-nums text-text-muted">{(r.start / fps).toFixed(1)} s</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-base text-text-muted">No compensation warnings in this recording.</p>
          )}
        </Card>
      </div>

      <AngleChart
        exercise={exercise}
        angleLabel={angleLabel}
        rows={rows}
        ghostRows={viewSide === 'both' ? ghostRows : null}
        frameCount={frameCount}
        fps={fps}
        frame={frame}
        warnings={main.warnings}
        onSeek={(f) => {
          setPlaying(false);
          seek(f);
        }}
      />
    </div>
  );
}
