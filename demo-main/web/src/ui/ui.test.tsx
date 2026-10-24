import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Banner } from './Banner';
import { Button } from './Button';
import { readChartTheme } from './chartTheme';
import { EmergencyBar } from './EmergencyBar';
import { Delta, StatTile } from './StatTile';
import { applyArea, areaForPath, getTheme, setTheme, THEME_STORAGE_PREFIX } from './theme';

const html = (node: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe('theme', () => {
  afterEach(() => localStorage.clear());

  it('maps paths to areas', () => {
    expect(areaForPath('/patient')).toBe('patient');
    expect(areaForPath('/patient/session')).toBe('patient');
    expect(areaForPath('/patients/p-maria')).toBe('care');
    expect(areaForPath('/care')).toBe('care');
    expect(areaForPath('/')).toBe('care');
  });

  it('defaults to dark for patient and light for care, and remembers a choice', () => {
    expect(getTheme('patient')).toBe('dark');
    expect(getTheme('care')).toBe('light');
    setTheme('care', 'dark');
    expect(localStorage.getItem(THEME_STORAGE_PREFIX + 'care')).toBe('dark');
    expect(getTheme('care')).toBe('dark');
  });

  it('puts theme and density on <html>', () => {
    applyArea('patient');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.density).toBe('large');
    applyArea('care');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.density).toBe('comfortable');
  });
});

describe('Button', () => {
  it('xl is at least 64 px tall (min-h-16) and md uses the density tap size', () => {
    expect(html(<Button size="xl">Start</Button>)).toContain('min-h-16');
    expect(html(<Button>Save</Button>)).toContain('min-h-tap');
  });

  it('renders links for `to` and `href`, a button otherwise', () => {
    expect(html(<Button to="/care">Care</Button>)).toMatch(/^<a [^>]*href="\/care"/);
    expect(html(<Button href="tel:911">Call</Button>)).toMatch(/^<a [^>]*href="tel:911"/);
    expect(html(<Button>Go</Button>)).toMatch(/^<button [^>]*type="button"/);
  });

  it('loading disables and marks busy', () => {
    const out = html(<Button loading>Saving</Button>);
    expect(out).toContain('disabled=""');
    expect(out).toContain('aria-busy="true"');
  });
});

describe('StatTile / Delta', () => {
  it('always shows a direction glyph, not just colour', () => {
    expect(html(<Delta value={6} goodWhen="up" label="from last week" />)).toContain('▲');
    expect(html(<Delta value={-3} goodWhen="up" />)).toContain('▼');
    expect(html(<Delta value={0} goodWhen="up" />)).toContain('No change');
  });

  it('colours by goodWhen', () => {
    expect(html(<Delta value={6} goodWhen="up" />)).toContain('text-success');
    expect(html(<Delta value={6} goodWhen="down" />)).toContain('text-danger');
  });

  it('renders label, value and unit', () => {
    const out = html(<StatTile label="Weak arm vs healthy" value={64} unit="%" delta={{ value: 6, goodWhen: 'up' }} />);
    expect(out).toContain('Weak arm vs healthy');
    expect(out).toContain('64');
    expect(out).toContain('%');
  });
});

describe('Banner / Badge / EmergencyBar', () => {
  it('danger banners use role=alert, others role=status', () => {
    expect(html(<Banner tone="danger" title="Stop" />)).toContain('role="alert"');
    expect(html(<Banner tone="info" title="FYI" />)).toContain('role="status"');
  });

  it('badges keep readable text colour', () => {
    expect(html(<Badge tone="warning">Compensation</Badge>)).toContain('text-text');
  });

  it('emergency bar has a tel:911 link and the warning-signs button', () => {
    const out = html(<EmergencyBar />);
    expect(out).toContain('href="tel:911"');
    expect(out).toContain('Stroke warning signs');
  });
});

describe('chart theme', () => {
  it('returns three series colours and a tooltip style', () => {
    const t = readChartTheme('light');
    expect(t.series).toHaveLength(3);
    t.series.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
    expect(t.tooltipStyle.backgroundColor).toBeTruthy();
  });
});
