import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression guard for the dark-mode hover bug class (docs/THEMING.md section 4).
// styles.css has a global `a:hover { background: accent; color: on-accent }`. An anchor component that overrides only the
// hover background keeps the dark on-accent text, which is unreadable once its new background is dark. Rule: any rule
// whose subject is an anchor on :hover and that sets a background must also set `color`.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir, ext, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, ext, out);
    else if (ext.some((e) => name.name.endsWith(e))) out.push(p);
  }
  return out;
}

// Classes known to sit on anchors: found in JSX (<a>, <Link>, <NavLink>) plus a documented list for dynamic className cases.
const EXTRA_ANCHOR_CLASSES = ['button', 'brand', 'adm-nav-link', 'adm-stat-link', 'challenge-card', 'cl-rung-link', 'cm-rung-link', 'wl-card-link'];
function anchorClasses() {
  const set = new Set(EXTRA_ANCHOR_CLASSES);
  const re = /<(?:a|Link|NavLink)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
  for (const file of walk(SRC, ['.jsx'])) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      for (const c of (m[1] || m[2] || '').replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (/^[a-zA-Z][\w-]*$/.test(c)) set.add(c);
    }
  }
  return set;
}

// Rules with an anchor subject that intentionally set a background without a colour (document why).
const ALLOWLIST = new Map([
  // (none today: add 'selector' => 'reason' here, with the reason)
]);

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

// Innermost `selector { declarations }` blocks, flattening @media wrappers.
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripComments(css)))) {
    const sel = m[1].trim();
    if (sel.startsWith('@')) continue;
    out.push({ selector: sel.replace(/\s+/g, ' '), body: m[2] });
  }
  return out;
}

function hasProp(body, names) {
  return body.split(';').some((d) => names.includes(d.split(':')[0].trim().toLowerCase()));
}

function subjectIsAnchorHover(selector, classes) {
  const subject = selector.split(/[\s>+~]+/).filter(Boolean).pop() || '';
  if (!/:hover\b/.test(subject)) return false;
  if (/^a(?![\w-])/.test(subject)) return true;
  const found = [...subject.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((x) => x[1]);
  return found.some((c) => classes.has(c));
}

test('anchor :hover rules that set a background also set a colour', () => {
  const classes = anchorClasses();
  const offenders = [];
  for (const file of walk(SRC, ['.css'])) {
    for (const { selector, body } of rules(fs.readFileSync(file, 'utf8'))) {
      if (!hasProp(body, ['background', 'background-color'])) continue;
      if (hasProp(body, ['color'])) continue;
      for (const part of selector.split(',').map((s) => s.trim())) {
        if (subjectIsAnchorHover(part, classes) && !ALLOWLIST.has(part)) offenders.push(`${path.relative(SRC, file)}: ${part}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'set an explicit colour on these hover rules (global a:hover sets the dark on-accent colour)');
});

test('the checker finds anchor hover rules and spots a missing colour', () => {
  const classes = new Set(['card-link']);
  assert.equal(subjectIsAnchorHover('.card-link:hover', classes), true);
  assert.equal(subjectIsAnchorHover('a.x:hover', classes), true);
  assert.equal(subjectIsAnchorHover('.panel:hover', classes), false);
  assert.equal(subjectIsAnchorHover('.card-link:hover .child', classes), false);
  const r = rules('@media (hover: hover) { .card-link:hover { background: red; } .ok:hover { color: #000; background: red; } }');
  assert.equal(r.length, 2);
  assert.equal(hasProp(r[0].body, ['color']), false);
  assert.equal(hasProp(r[1].body, ['color']), true);
  assert.ok(anchorClasses().has('challenge-card'));
});
