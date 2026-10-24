// The care-side rules sweep (CONVERGENCE_PLAN §6.3), free of api.ts so it can be unit-tested.
import { isNotImplemented } from './errors';

export interface SweepDeps {
  listPatientIds(): Promise<string[]>;
  /** Changes whenever the patient's sessions or watch data change. */
  fingerprint(patientId: string): Promise<string>;
  evaluate(patientId: string): Promise<unknown>;
  /** Local day; part of the key so day-based rules (missed sessions) re-run after midnight. */
  today(): string;
}

export interface SweepResult {
  evaluated: string[];
  skipped: string[];
  failed: string[];
}

export interface RulesSweep {
  /** One pass over every patient. Concurrent calls share the pass in flight. */
  run(): Promise<SweepResult>;
  /** True once the data layer said evaluatePatient isn't available; later runs do nothing. */
  readonly disabled: boolean;
}

export function createRulesSweep(deps: SweepDeps): RulesSweep {
  const lastKey = new Map<string, string>();
  let disabled = false;
  let inFlight: Promise<SweepResult> | null = null;

  async function sweep(): Promise<SweepResult> {
    const result: SweepResult = { evaluated: [], skipped: [], failed: [] };
    if (disabled) return result;
    let ids: string[];
    try {
      ids = await deps.listPatientIds();
    } catch {
      return result;
    }
    const day = deps.today();
    for (const id of ids) {
      let key: string;
      try {
        key = `${day}|${await deps.fingerprint(id)}`;
      } catch {
        result.failed.push(id);
        continue;
      }
      if (lastKey.get(id) === key) {
        result.skipped.push(id);
        continue;
      }
      try {
        await deps.evaluate(id);
        lastKey.set(id, key);
        result.evaluated.push(id);
      } catch (e) {
        if (isNotImplemented(e)) {
          disabled = true;
          break;
        }
        result.failed.push(id);
      }
    }
    return result;
  }

  return {
    run() {
      inFlight ??= sweep().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    get disabled() {
      return disabled;
    },
  };
}

/** Small stable string hash (djb2), for fingerprints. */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
