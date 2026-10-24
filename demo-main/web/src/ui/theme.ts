/**
 * Theme (light/dark) and density (comfortable/large) per app area. FROZEN after WP0.
 *
 * - Area comes from the path: /patient and /patient/* → 'patient', everything else → 'care'
 *   (the landing page uses the care theme).
 * - Defaults: patient = dark + large, care = light + comfortable. The user's choice per area is kept in
 *   localStorage under `rehabtrack.theme.<area>`.
 * - index.html runs the same logic inline before first paint (no flash); `useRouteTheme()` (mounted once
 *   in App.tsx) re-applies it on every route change. Keep the two in sync.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';

export type Theme = 'light' | 'dark';
export type Density = 'comfortable' | 'large';
export type Area = 'patient' | 'care';

export const THEME_STORAGE_PREFIX = 'rehabtrack.theme.';
const CHANGE_EVENT = 'rehabtrack:theme';

export const DEFAULT_THEME: Record<Area, Theme> = { patient: 'dark', care: 'light' };
export const AREA_DENSITY: Record<Area, Density> = { patient: 'large', care: 'comfortable' };

/** '/patient', '/patient/…' → 'patient'; anything else → 'care'. */
export function areaForPath(pathname: string): Area {
  return /^\/patient(\/|$)/.test(pathname) ? 'patient' : 'care';
}

export function densityFor(area: Area): Density {
  return AREA_DENSITY[area];
}

/** The stored theme for an area, or its default. */
export function getTheme(area: Area): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_PREFIX + area);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // Storage blocked: fall back to the default.
  }
  return DEFAULT_THEME[area];
}

/** The area whose theme is currently on <html> (from the path, so it is right before React mounts). */
export function currentArea(): Area {
  return areaForPath(typeof window === 'undefined' ? '/' : window.location.pathname);
}

/** The theme currently applied to <html>. */
export function appliedTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Put an area's theme + density on <html>. */
export function applyArea(area: Area): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const theme = getTheme(area);
  if (html.getAttribute('data-theme') !== theme) html.setAttribute('data-theme', theme);
  const density = densityFor(area);
  if (html.getAttribute('data-density') !== density) html.setAttribute('data-density', density);
  html.style.colorScheme = theme;
}

/** Remember an area's theme; applies it right away when that area is on screen. */
export function setTheme(area: Area, theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_PREFIX + area, theme);
  } catch {
    // Not remembered; still applied for this page.
  }
  if (currentArea() === area) applyArea(area);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { area, theme } }));
}

export function toggleTheme(area: Area): Theme {
  const next: Theme = getTheme(area) === 'dark' ? 'light' : 'dark';
  setTheme(area, next);
  return next;
}

/** Subscribe to theme changes (this tab via setTheme, other tabs via the storage event). */
export function onThemeChange(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(THEME_STORAGE_PREFIX)) {
      applyArea(currentArea());
      cb();
    }
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

/** Mount once (App.tsx): keeps <html data-theme / data-density> in sync with the route. */
export function useRouteTheme(): Area {
  const { pathname } = useLocation();
  const area = areaForPath(pathname);
  useEffect(() => {
    applyArea(area);
  }, [area]);
  return area;
}

/**
 * The theme for an area (default: the area of the current route) and setters.
 * Re-renders when the theme changes anywhere (other components, other tabs).
 */
export function useTheme(area?: Area): { area: Area; theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const { pathname } = useLocation();
  const a = area ?? areaForPath(pathname);
  const theme = useSyncExternalStore(
    onThemeChange,
    () => getTheme(a),
    () => DEFAULT_THEME[a],
  );
  const set = useCallback((t: Theme) => setTheme(a, t), [a]);
  const toggle = useCallback(() => {
    toggleTheme(a);
  }, [a]);
  return { area: a, theme, setTheme: set, toggle };
}

/**
 * The theme actually on <html> right now, re-read whenever data-theme changes. Use this for anything
 * that must match the painted colours (charts, canvases). Works outside the router.
 */
export function useAppliedTheme(): Theme {
  const [theme, setThemeState] = useState<Theme>(appliedTheme);
  useEffect(() => {
    const html = document.documentElement;
    const obs = new MutationObserver(() => setThemeState(appliedTheme()));
    obs.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    setThemeState(appliedTheme());
    return () => obs.disconnect();
  }, []);
  return theme;
}
