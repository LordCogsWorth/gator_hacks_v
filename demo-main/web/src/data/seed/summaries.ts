/**
 * Pre-generated two-sentence weekly summaries for the demo patients. Every number is computed from the seeded
 * data, so the text never states something the charts don't show. No plan advice, no medical conclusions.
 */
import type { WeeklySummary } from '../../types';
import { calendarDaysBetween, sessionTimeline } from '../../rules/engine';
import { PHASE_TARGETS } from '../../rules/constants';
import { startOfWeek } from '../derive';
import { localDate } from '../validate';
import type { Snapshot } from '../source';

const r = (n: number) => Math.round(n);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function pregeneratedSummary(s: Snapshot, now: Date, createdAt: string): WeeklySummary {
  const timeline = sessionTimeline(s.patient.id, s.sessions, s.results);
  const scored = timeline.filter((t) => t.symmetry != null);
  const sym = scored.map((t) => t.symmetry as number);
  const recent = scored.filter((t) => now.getTime() - Date.parse(t.session.startedAt) <= 14 * 86_400_000);
  const recentSym = recent.map((t) => t.symmetry as number);
  const last3 = scored.slice(-3);
  const comp3 = r(mean(last3.map((t) => t.compensation ?? 0)));
  const watch = [...s.watch].sort((a, b) => a.date.localeCompare(b.date));
  const first = watch[0];
  const latest = watch[watch.length - 1];
  const lastSession = timeline[timeline.length - 1];
  const name = s.patient.name.split(' ')[0];

  let text: string;
  if (s.patient.id === 'p-maria' && scored.length >= 3) {
    const span = calendarDaysBetween(new Date(scored[0].session.startedAt), now);
    text =
      `${name}'s symmetry rose from ${r(sym[0])}% to ${r(sym[sym.length - 1])}% across ${scored.length} sessions in the ` +
      `last ${span} days, with compensation steady at about ${comp3}% of weak-arm reps. ` +
      `The last 3 sessions averaged ${r(mean(last3.map((t) => t.symmetry as number)))}%, above the phase ${s.patient.phase} ` +
      `target of ${PHASE_TARGETS[s.patient.phase]}%, and resting heart rate held at ${latest?.restingHr ?? '-'} bpm.`;
  } else if (s.patient.id === 'p-james' && recent.length > 0 && first && latest && lastSession) {
    const gap = calendarDaysBetween(new Date(lastSession.session.startedAt), now);
    const days = calendarDaysBetween(new Date(`${first.date}T12:00:00`), new Date(`${latest.date}T12:00:00`));
    text =
      `${name}'s symmetry has stayed between ${r(Math.min(...recentSym))}% and ${r(Math.max(...recentSym))}% across ` +
      `${recent.length} sessions in the last 14 days, and the last session was ${gap} days ago. ` +
      `Watch data shows weak-arm active time falling from ${first.weakArmActiveMin} to ${latest.weakArmActiveMin} minutes ` +
      `a day over the last ${days} days, with the use ratio down from ${first.useRatio} to ${latest.useRatio}.`;
  } else if (s.patient.id === 'p-priya' && scored.length >= 3 && latest) {
    const weekBefore = watch.find((w) => w.date === localDate(new Date(now.getTime() - 7 * 86_400_000)));
    text =
      `${name}'s symmetry rose from ${r(sym[0])}% to ${r(sym[sym.length - 1])}%, but about ${comp3}% of weak-arm reps ` +
      `in the last 3 sessions involved leaning or shoulder hiking. ` +
      `Resting heart rate climbed from ${weekBefore?.restingHr ?? first?.restingHr ?? '-'} to ${latest.restingHr} bpm over ` +
      `the past week, and the latest systolic reading of ${latest.bpSys} mmHg is above the limit of ${s.patient.bpLimitSys}.`;
  } else {
    const open = s.alerts.filter((a) => !a.acknowledged).length;
    text =
      `${name} has ${scored.length} scored session(s)` +
      (sym.length ? `, with the latest symmetry at ${r(sym[sym.length - 1])}%.` : '.') +
      ` There are ${open} open alert(s) for the care team to review.`;
  }

  return {
    patientId: s.patient.id,
    weekStart: localDate(startOfWeek(now)),
    text,
    model: 'pregenerated',
    source: 'pregenerated',
    createdAt,
  };
}
