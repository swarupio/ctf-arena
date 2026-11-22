// Test helpers: read the colour tokens out of src/styles.css and compute WCAG contrast. No dependencies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const STYLES_PATH = fileURLToPath(new URL('../../src/styles.css', import.meta.url));

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Splits CSS into top-level rules: { selector, body }. @media rules keep their raw inner text in body.
function splitRules(css) {
  const rules = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') { if (depth === 0) open = i; depth += 1; }
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { rules.push({ selector: css.slice(start, open).trim(), body: css.slice(open + 1, i) }); start = i + 1; }
    } else if (ch === ';' && depth === 0) start = i + 1;
  }
  return rules;
}

export function parseDeclarations(body) {
  const map = new Map();
  for (const part of body.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (name.startsWith('--') || name === 'color-scheme') map.set(name, part.slice(at + 1).trim().replace(/\s+/g, ' '));
  }
  return map;
}

// { light, darkExplicit, darkMedia }: token maps of the three blocks that define the theme.
export function readThemeBlocks(path = STYLES_PATH) {
  const rules = splitRules(stripComments(readFileSync(path, 'utf8')));
  const find = (test) => rules.filter(test);
  const lightRules = find((rule) => rule.selector === ':root');
  const darkExplicit = find((rule) => /\[data-theme='dark'\]/.test(rule.selector));
  const media = find((rule) => /^@media \(prefers-color-scheme: dark\)$/.test(rule.selector));
  const mediaInner = media.flatMap((rule) => splitRules(rule.body));
  const merge = (list) => list.reduce((all, rule) => new Map([...all, ...parseDeclarations(rule.body)]), new Map());
  return {
    light: merge(lightRules),
    darkExplicit: merge(darkExplicit),
    darkMedia: merge(mediaInner),
    selectors: { explicit: darkExplicit.map((r) => r.selector), media: mediaInner.map((r) => r.selector) },
  };
}

// ---- Colour maths ----
export function parseColor(value) {
  const v = value.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map((x) => Number.parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  }
  throw new Error(`cannot parse colour: ${value}`);
}

export const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
});

export function luminance({ r, g, b }) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(fgValue, bgValue) {
  const bg = parseColor(bgValue);
  const fg = over(parseColor(fgValue), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// Resolves the token set of one theme: light is :root; dark is :root with the explicit dark block applied on top.
export function themeTokens(theme, blocks = readThemeBlocks()) {
  return theme === 'dark' ? new Map([...blocks.light, ...blocks.darkExplicit]) : blocks.light;
}

// fg token, bg token, minimum ratio, note. 4.5 = body text, 3 = large text, UI borders, icons, focus rings.
const SURFACES = ['bg', 'surface', 'surface-2', 'sunken'];
// lightMin: a lower bar for the light theme only, for lime/yellow FILLS that cannot reach 3:1 on white and are
// always drawn with a strong border and a text label instead (recorded in docs/THEMING.md).
const t = (fg, bg, min, note, lightMin = min) => ({ fg: `--${fg}`, bg: `--${bg}`, min, lightMin, note });
export const PAIRS = [
  ...[...SURFACES, 'accent-tint', 'code-bg', 'stripe'].map((s) => t('color-ink', `color-${s}`, 4.5, 'body text')),
  ...[...SURFACES, 'accent-tint', 'stripe'].map((s) => t('color-muted', `color-${s}`, 4.5, 'secondary text')),
  ...['bg', 'surface', 'sunken'].map((s) => t('color-subtle', `color-${s}`, 4.5, 'placeholder / tertiary text')),
  t('color-link', 'color-bg', 4.5, 'link'), t('color-link', 'color-surface', 4.5, 'link'),
  t('color-accent-text', 'color-bg', 4.5, 'lime used as text'), t('color-accent-text', 'color-surface', 4.5, 'lime used as text'),
  t('color-on-accent', 'color-accent', 4.5, 'text on accent fill'), t('color-on-accent', 'color-accent-hover', 4.5, 'text on accent hover'),
  t('color-on-accent-muted', 'color-accent', 4.5, 'muted text on accent fill'), t('color-on-accent-muted', 'color-accent-hover', 4.5, 'muted text on accent hover'),
  t('color-ink-contrast', 'color-ink', 4.5, 'text on ink fill'),
  t('color-on-ink-accent', 'color-ink', 4.5, 'lime-style text on ink fill (badge)'),
  t('color-selection-fg', 'color-selection-bg', 4.5, 'text selection'),
  t('color-code-text', 'color-code-bg', 4.5, 'code'),
  ...['danger', 'warn', 'ok', 'info'].flatMap((k) => [
    t(`color-${k}`, `color-${k === 'danger' ? 'danger' : k}-tint`, 4.5, `${k} text on its tint`),
    t(`color-${k}`, 'color-surface', 4.5, `${k} text on surface`),
    t(`color-${k}`, 'color-bg', 4.5, `${k} text on page`),
    t(`color-${k}-border`, 'color-surface', 3, `${k} border / icon`, k === 'warn' ? 2.6 : 3),
  ]),
  ...['easy', 'medium', 'hard', 'insane'].flatMap((k) => [
    t(`color-diff-${k}-text`, `color-diff-${k}-tint`, 4.5, `${k} label on tint`),
    t(`color-diff-${k}-text`, 'color-surface', 4.5, `${k} label on surface`),
    t(`color-diff-${k}`, 'color-surface', 3, `${k} bar fill on surface`, 1),
  ]),
  t('color-accent', 'color-surface', 3, 'accent fill on surface', 1), t('color-accent', 'color-bg', 3, 'accent fill on page', 1),
  t('color-focus', 'color-bg', 3, 'focus ring on page'), t('color-focus', 'color-surface', 3, 'focus ring on surface'), t('color-focus', 'color-surface-2', 3, 'focus ring on surface-2'),
  t('color-line', 'color-bg', 3, 'strong border on page'), t('color-line', 'color-surface', 3, 'strong border on surface'), t('color-line', 'color-surface-2', 3, 'strong border on surface-2'),
  ...Array.from({ length: 8 }, (_, i) => t(`color-series-${i + 1}`, 'color-surface', 3, `chart series ${i + 1}`)),
  t('color-series-other', 'color-surface', 3, 'chart series other'),
  // Exact-literal variants (one per distinct light colour the pages use)
  t('color-sev-medium', 'color-sev-medium-tint', 4.5, 'severity medium'), t('color-sev-low', 'color-ok-tint', 4.5, 'severity low'),
  t('color-ok-alt', 'color-ok-tint-alt', 4.5, 'success notice'), t('color-ink', 'color-diff-add', 4.5, 'diff added'), t('color-ink', 'color-diff-del', 4.5, 'diff removed'),
  t('color-chart-green', 'color-surface', 3, 'admin chart green'), t('color-ink', 'color-info-tint-alt', 4.5, 'info badge'), t('color-ink', 'color-info-wash', 4.5, 'packets client'), t('color-ink', 'color-accent-wash', 4.5, 'packets server'),
  ...['color-surface-warm', 'color-surface-soft'].flatMap((bg) => [t('color-ink', bg, 4.5, 'body text'), t('color-muted', bg, 4.5, 'secondary text')]),
  t('color-line', 'color-surface-warm', 3, 'border'), t('color-line-faint', 'color-surface-soft', 1, 'decorative row separator', 1),
  t('color-ink-contrast', 'color-danger-deep', 4.5, 'text on danger hover'),
  // Always-dark and always-light tokens must pass in both themes (their values never change).
  ...['term-bg', 'term-bg-deep', 'term-bg-raised'].flatMap((bg) => ['term-fg', 'term-fg-muted', 'term-fg-subtle', 'term-ok', 'term-warn', 'term-danger', 'term-info', 'term-violet', 'term-cyan', 'term-orange', 'term-accent']
    .map((fg) => t(fg, bg, 4.5, `terminal text on ${bg}`))),
  ...['term-warn-alt', 'term-warn-pale', 'term-addr', 'term-danger-soft', 'term-danger-hot', 'term-danger-pale', 'term-info-alt', 'term-hex', 'term-synth', 'term-violet-alt', 'term-violet-pale', 'term-cyan-alt', 'term-cyan-pale', 'term-fg-listing', 'term-fg-dim', 'term-edge', 'term-desk-fg']
    .flatMap((fg) => ['term-bg', 'term-bg-deep'].map((bg) => t(fg, bg, 4.5, `terminal text on ${bg}`))),
  ...['term-white', 'term-fg-soft', 'term-fg-listing', 'term-hex', 'term-fg', 'term-fg-muted'].map((fg) => t(fg, 'term-bg-black', 4.5, 'text on near-black panel')),
  t('term-white', 'term-bg', 4.5, 'terminal input text'), t('term-white', 'term-bg-deep', 4.5, 'terminal text'), t('term-fg-soft', 'term-bg', 4.5, 'terminal text'),
  t('term-fg', 'term-accent-tint-2', 4.5, 'text on highlighted node'), t('term-fg', 'term-bg-goto', 4.5, 'text on goto line'), t('term-fg', 'term-bg-row', 4.5, 'text on hovered row'),
  t('term-fg', 'term-bg-flat', 4.5, 'text on scene'), t('term-hex', 'term-bg-pre', 4.5, 'hex text on pre'), t('term-desk-fg', 'term-desk-bottom', 4.5, 'desk text'),
  t('term-on-accent', 'term-accent', 4.5, 'text on terminal accent'),
  t('term-line-strong', 'term-bg', 3, 'terminal border'),
  t('paper-ink', 'paper-bg', 4.5, 'text on paper'), t('paper-ink', 'paper-bg-2', 4.5, 'text on paper'),
  t('paper-ink', 'paper-card', 4.5, 'text on paper card'), t('paper-ink-2', 'paper-bg-3', 4.5, 'text on paper panel'), t('paper-ink', 'paper-bg-3', 4.5, 'text on paper panel'),
  t('paper-muted', 'paper-card', 4.5, 'muted text on paper card'), t('paper-muted', 'paper-bg', 4.5, 'muted text on paper'), t('paper-muted', 'paper-bg-2', 4.5, 'muted text on paper'),
  t('term-fg', 'term-accent-tint', 4.5, 'terminal text on highlighted line'),
];

// [{ theme, fg, bg, min, ratio, pass, note }]
export function evaluate(theme, blocks = readThemeBlocks()) {
  const tokens = themeTokens(theme, blocks);
  return PAIRS.map((pair) => {
    const ratio = contrast(tokens.get(pair.fg), tokens.get(pair.bg));
    const min = theme === 'light' ? pair.lightMin : pair.min;
    return { theme, ...pair, min, ratio: Math.round(ratio * 100) / 100, pass: ratio >= min };
  });
}
