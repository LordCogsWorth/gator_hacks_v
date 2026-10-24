# WP0 Scaffold: report

Status: **done, uncommitted** (per coordinator: no branch, no commit, no push). Nothing outside `demo-main/` was modified.

## Acceptance

| Check | Result |
|---|---|
| `cd demo-main/web && npm install && npm run build && npm test` | all exit 0 (13 tests pass: `src/ui/ui.test.tsx`; script keeps `--passWithNoTests`) |
| `ls public/mediapipe/wasm/*.wasm` | `vision_wasm_internal.wasm`, `vision_wasm_nosimd_internal.wasm` (postinstall copy, git-ignored) |
| `/` landing, `/care` light, `/patient` dark | verified in the browser against a scratchpad copy of Raghav/api (port 8091) |
| Theme toggle per area, no flash on reload | verified: care→dark and patient→light persist per area; a reload paints the stored theme straight away (inline script) |
| `grep -rn "Messages\|Settings\|localDemo" src` | 0 hits |
| `grep -rni diagnos src` | 0 hits |
| Bundle | initial load = `index` 7.5 kB + `react` 54 kB gzip. `charts` (107 kB gzip) and `three` load only when a page needs them |
| Phone, 390 px | patient header (Voice, Theme, warning signs, Call 911) fits on one row; every shell control is 64 px tall |

## Files

**Created**
- `demo-main/.gitattributes`
- `demo-main/{supabase,watch,docs,tools}/.gitkeep`, `demo-main/.reports/WP0.md`
- `web/vercel.json`, `web/scripts/copy-mediapipe-wasm.mjs`
- `web/src/Home.tsx`
- `web/src/care/replay/ReplayPage.tsx` (stub for WP6)
- `web/src/test/setup.ts` (vitest; see Known issues)
- `web/src/ui/`: `tokens.css`, `theme.ts`, `chartTheme.ts`, `cx.ts`, `Button.tsx`, `Card.tsx`, `StatTile.tsx`, `Banner.tsx`, `Badge.tsx`, `ChartCard.tsx`, `Modal.tsx`, `EmergencyBar.tsx`, `ThemeToggle.tsx`, `DataModeBadge.tsx`, `PageHeader.tsx`, `EmptyState.tsx`, `SegmentedControl.tsx`, `Spinner.tsx`, `forms.ts`, `index.ts`, `ui.test.tsx`

**Copied from Raghav/web, then changed**
- `package.json`: renamed, deps and scripts per §10. `package-lock.json` regenerated.
- `vite.config.ts`: manualChunks and the vitest config.
- `tailwind.config.js`: colours come from the tokens, plus tap sizes, radii, shadows and fonts.
- `index.html`: pre-paint theme script; Google Fonts link removed.
- `.env.example`, `.gitignore` (adds `public/mediapipe/`).
- `src/main.tsx`: imports the fonts and tokens.
- `src/App.tsx`: final routes, lazy-loaded.
- `src/Brand.tsx`: adds `TEAM_LINE` and `BrandLockup`.
- `src/index.css`: rebased on the tokens.
- `src/vite-env.d.ts`, `src/types.ts` (§5.1), `src/api.ts` (bridge).
- `src/camera/mediapipeTracker.ts`: only `WASM_URL`, which now tries local first.
- `src/patient/PatientApp.tsx`: cut routes, legacy redirect and the `patient-area` class removed.
- `src/patient/components/Layout.tsx`: two-item nav (Home, My sessions), `ui/EmergencyBar`, `ThemeToggle`, `DataModeBadge`, colours on tokens. `Card` and `BigButton` now wrap the `ui` versions.
- `src/patient/screens/Dashboard.tsx`: only removed `CareTeamCard` and the `localDemo` import.
- `src/patient/demo.tsx`: renamed type `Settings` to `DemoOptions`; copy fix.
- `src/patient/identity.tsx`: copy fix.
- `src/patient/api.ts`: comment only.
- `src/patient/patient.css`: page-wide rules removed; slider thumb now uses tokens.
- `src/care/CareLayout.tsx`: header and footer on tokens, `ThemeToggle`, `DataModeBadge`.
- `src/care/{PatientList,PatientDetail,PlanCards}.tsx`: mechanical swap of literal classes for tokens only (`bg-white`→`bg-surface`, `text-slate-4/5/600`→`text-text-muted`, `text-slate-7/800`→`text-text`, amber borders→`border-warning/40`, `text-white`→`text-primary-ink`).

**Deleted**
- `src/patient/localDemo.ts`, `src/patient/screens/Messages.tsx`, `src/patient/screens/Settings.tsx`

**Copied unchanged**
- `public/models/*.task`, `tsconfig*.json`, `postcss.config.js` and every other source file

## Design tokens (`ui/tokens.css`)

All tokens are RGB triplets on `:root[data-theme=light|dark]`. Hex values are exactly as in §8.

Tailwind class names match the token names: `bg-bg`, `bg-surface`, `bg-surface-2`, `border-border`, `text-text`, `text-text-muted`, `bg-primary`, `text-primary-ink`, `hover:bg-primary-hover`, `bg-primary-soft`, `bg-danger`, `text-danger-ink`, `bg-danger-soft`, `text-warning`, `bg-warning-soft`, `text-success`, `text-info`, `ring-focus`, `chart-1..3`, `chart-grid`, `chart-target`, `row-flash`.

- Every colour accepts alpha, e.g. `bg-primary/10`.
- A bare `border` uses `--border`; a bare `ring` uses `--focus`.
- **Tokens added by WP0:** `--success-soft`, `--info-soft` (backgrounds for Banner and Badge), `--overlay` (modal backdrop, use as `bg-overlay/60`), `--shadow`.

**Density** (set on `<html data-density>`):

| | Root font | `--tap` | `--radius-card` | `--radius-control` |
|---|---|---|---|---|
| comfortable (care) | 16 px | 44 px | 1rem | 0.75rem |
| large (patient) | 18 px | 64 px | 1.25rem | 0.875rem |

- Tailwind utilities: `min-h-tap`, `min-w-tap`, `h-tap`, `w-tap`, `p-tap`, `rounded-card`, `rounded-control`, `shadow-card`, `shadow-raised`, `shadow-modal`, `font-display`/`font-brand` (IBM Plex Sans) and `font-sans` (Source Sans 3), `animate-row-flash`. The `.row-flash` class still exists.
- Base styles in `index.css`: the global `:focus-visible` ring is 4 px in `--focus` with a 3 px offset; `prefers-reduced-motion` stops all animations.
- **Legacy aliases** (so screens not yet rethemed stay readable): `ink`, `mist`, `foam`, `teal{,-soft,-deep}`, `alert{,-soft}`, `brand{,-ink}` all map to tokens. Use the token names in new code.

## ui/* component API (import from `src/ui` or the individual file)

```ts
// Button.tsx — <button type="button">, or <Link> when `to` is set, or <a> when `href` is set
Button(props: ButtonHTMLAttributes & {
  variant?: 'primary'|'secondary'|'ghost'|'danger';            // default 'primary'
  size?: 'md'|'xl';   // md = min-h-tap (44 care / 64 patient); xl = min-h-16 (≥64 px), text-xl
  icon?: ReactNode; iconRight?: ReactNode;                       // icons are sized automatically
  loading?: boolean;  // spinner, aria-busy, disabled
  fullWidth?: boolean; to?: To; href?: string; replace?: boolean; target?: string; rel?: string;
})                                                               // forwardRef
buttonClass(variant?, size?, extra?) => string

// Card.tsx
Card(props: HTMLAttributes & { title?; subtitle?; action?; icon?: ReactNode;
  tone?: 'default'|'primary'|'warning'|'danger'; padding?: 'md'|'none'; footer?: ReactNode;
  titleAs?: 'h2'|'h3'; as?: 'section'|'div'|'article' })

// StatTile.tsx
StatTile({ label, value, unit?, delta?: StatDelta, trend?: { direction: Trend; goodWhen?; label? },
  hint?, icon?, tone?: 'default'|'primary'|'warning'|'danger', className? })
type StatDelta = { value: number; goodWhen: 'up'|'down'; label?: string; unit?: string; precision?: number }
Delta(StatDelta & { className? })            // "▲ 6 from last week"; 0 → "▬ No change"; green good / red bad; sr-only "Up"/"Down"
TrendIndicator({ direction: Trend, goodWhen?, label?, className? })   // "▲ Improving"; 'none' → "—"

// Banner.tsx — role="alert" for danger, role="status" otherwise; text is always --text
Banner({ tone: 'info'|'success'|'warning'|'danger', title, children?, action?, icon?: ReactNode|false,
  onDismiss?, dismissLabel?, className? })

// Badge.tsx — text is always --text; the tone shows in background, border and dot/icon
Badge({ tone?: 'neutral'|'primary'|'info'|'success'|'warning'|'danger', children, icon?, dot?: boolean,
  size?: 'sm'|'md', title?, className? })

// ChartCard.tsx — wraps a single Recharts chart element in a ResponsiveContainer
ChartCard({ title, subtitle?, height?: number /*240*/, action?, legend?, footer?, empty?: ReactNode,
  children: ReactElement, responsive?: boolean /*true*/, description?, className? })
LegendItem({ color, label, dashed? })

// chartTheme.ts
useChartTheme(): { theme, grid, axis, text, muted, surface, border, series: [c1,c2,c3], target, primary,
  info, warning, danger, success, tick: {fill,fontSize}, tooltipStyle, tooltipLabelStyle, tooltipItemStyle,
  cursor }   // hex strings read from the CSS variables; re-read when data-theme changes
EXERCISE_SERIES: Record<Exercise, 0|1|2>; readChartTheme(theme); readToken(name)

// EmergencyBar.tsx
EmergencyBar({ onSignsOpen?: () => void, className? })  // "Stroke warning signs" (icon-only below sm) + "Call 911" tel:911
WarningSignsDialog({ open, onClose })                    // the BE-FAST modal on its own
WARNING_SIGNS_SPEECH: string                             // the patient Layout passes () => speak(WARNING_SIGNS_SPEECH)

// Others
ThemeToggle({ area?: 'patient'|'care' /*default: area of the current route*/, label?: 'always'|'responsive'|'never', className? })
DataModeBadge({ className? })                            // reads api.dataMode()
PageHeader({ title, subtitle?, actions?, eyebrow?, back?: { to, label }, meta?, className? })   // renders the page's h1
EmptyState({ title, children?, icon?: ReactNode|false, action?, className? })
Modal({ open, onClose, title, children?, footer?, tone?: 'default'|'danger', closeLabel?, className? })  // portal, focus trap, Esc, focus restore
SegmentedControl<T>({ options: {value,label,icon?,disabled?}[], value, onChange, label, fullWidth?, className? })  // aria-pressed buttons
Spinner({ label?, className? })
INPUT_CLASS, LABEL_CLASS, HINT_CLASS, ERROR_CLASS    // forms.ts, for care editors
cx(...classes)

// theme.ts
type Theme='light'|'dark'; type Density='comfortable'|'large'; type Area='patient'|'care'
areaForPath(path); getTheme(area); setTheme(area, t); toggleTheme(area); applyArea(area); densityFor(area)
useTheme(area?) => { area, theme, setTheme, toggle }; useAppliedTheme() => Theme; useRouteTheme()  // mounted once in App
onThemeChange(cb) => unsubscribe;   storage key: `rehabtrack.theme.<area>`
```

`Brand.tsx` exports `BRAND_NAME`, `TEAM_LINE` ("by Ctrl+Alt+Heal"), `BrandMark({className})` and `BrandLockup({area?, compact?, className?})`.

## api.ts (bridge)

- **Real calls over HTTP to `VITE_API_BASE`:** `getPatients`, `getPatient`, `getPatientSessions`, `getPatientWatch`, `getApprovedPlan` (now `getPatient().approvedPlan`, no error-string matching), `postSession`, `uploadReplay`, `getSessionReplays`, `getSessionReplay`, `acknowledgeAlert`, `approvePlan`, `dismissPlan`, `getConfig`.
- **Stubs:** `getPatientWatchSessions` returns `[]`, `getWeeklySummary` returns `null`, `dataMode` returns `'local'`, `onDataChange` does nothing.
- **Throw `ApiError(…, 501, 'not_implemented')`:** `savePlan`, `setNextCheckin`, `submitWatchDaily`, `refreshWeeklySummary`, `evaluatePatient`, `resetDemoData`.
- **`ApiError`:** constructor is `(message, status, code)`. `code` is derived from the HTTP status when not given (404→not_found, 409→conflict, 501→not_implemented, 0 or 5xx→network, otherwise invalid). Fetch failures now throw `ApiError(…, 0, 'network')`.
- **Removed:** `getOpenAlerts` and `API_BASE`.

## Deviations

1. **Function-form `manualChunks`, plus a `react` chunk.** The object form in §10 (and the function form without the `react` chunk) moves React into `charts`, so every page preloaded the charts chunk (150 kB gzip). The chunk names `three`, `charts` and `supabase` are kept.
2. **`src/test/setup.ts` added.** Node 26 on this machine defines its own `localStorage` global, which stops vitest from installing jsdom's storage. The setup file points `localStorage` and `sessionStorage` at jsdom. **WP1's LocalSource tests depend on it.**
3. **WP0 changed more of the patient shell and care files than "minimal".** This was needed for the "theme toggle works" check: the patient Layout shell, Card and BigButton now use tokens, and the three care pages had a mechanical swap of literal classes for tokens. The screens' inner content is still not rethemed (see Known issues).
4. **Extra ui pieces beyond §8:** `Modal`, `SegmentedControl`, `Spinner`, `LegendItem`, `Delta`, `TrendIndicator`, `forms.ts`, plus the 4 added tokens. All are additive.
5. **Patient nav labels are "Home" and "My sessions"** (§8). On phones the patient header hides the logo so the controls fit on one row.

## Known issues (owned by WP4 / WP5)

- The inner content of patient screens (Dashboard tiles, CheckIn, Summary, History, SessionRun, the `WhoAreYou` picker, the demo panel) still uses `neutral-*` literals. It looks right in dark but stays dark-on-light in the patient light theme.
- Care pages are readable in dark mode, but the charts still use the `CHART_COLORS` literals; switch them to `useChartTheme`.
- Some patient buttons inside the Dashboard are 44–48 px; WP4 should move them to `Button`.
- `npm install` warns about `allow-scripts` for esbuild. Harmless here (builds pass) but noted for CI.
- In the bridge, `resetDemoData` throws, so "Reset demo data" on `/` shows an info banner until WP1 lands.

## Requests to other WPs

- **WP1:** move `ApiError` to `data/errors.ts` and re-export it from `api.ts` (signature unchanged). Keep `src/test/setup.ts` in `setupFiles`. `dataMode()` drives `DataModeBadge` and the Reset button on Home.
- **WP4:**
  - Retheme the patient screens with `ui/*`; `Card`/`BigButton` from Layout can be replaced by direct `ui` imports.
  - Use `Button size="xl"` for the hero Start.
  - Use `DataModeBadge` in the footer (it is currently only in the lg sidebar).
- **WP5:**
  - Use `ChartCard` and `useChartTheme()` (delete `CHART_COLORS` and the local `ChartCard` in `PatientDetail`).
  - Use `PageHeader`, `Banner`, `Badge` and `SegmentedControl`; use `INPUT_CLASS` for the plan editor.
  - `useRulesSweep` goes in `CareLayout`.
- **WP6:** replace `care/replay/ReplayPage.tsx`. The route is already wired and lazy-loaded; `useChartTheme()` gives `danger`, `grid` and the series colours for the canvas.
- **WP8:** decide whether to drop the legacy Tailwind aliases once WP4 and WP5 are done.

## Verification commands

```
cd demo-main/web && npm install && npm run build && npm test
ls public/mediapipe/wasm/*.wasm
grep -rn "Messages\|Settings\|localDemo" src ; grep -rni diagnos src     # both empty
# browser (bridge): copy Raghav/api elsewhere, npm i && npm run seed && PORT=8091 npm start
VITE_API_BASE=http://localhost:8091/api npx vite --port 5180 --strictPort
```

Port 8081 was already taken by someone else's `node dev-server.js` (PID 7655), so I used 8091 and left that process alone. My servers on 8091 and 5180 are stopped.
