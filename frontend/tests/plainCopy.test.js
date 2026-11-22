import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORY_LEGEND, EMPTY_SUBMIT_HINT, FLAG_HELP, SERVER_INTRO, challengeErrorMessage } from '../src/pages/challengeHelpers.js';
import { levelName, unlockText } from '../src/components/cipherlab/helpers.js';
import { FIRST_MOVE, GLOSSARY, isFirstCabinet } from '../src/components/crackme/helpers.js';
import { BOUNTY_NOTE, badgeText, lockNote, severityMeta } from '../src/components/weblab/helpers.js';
import { BRIEFING_PREFIX, START_HERE, briefingKey, briefingOpen, isBriefingSeen, markBriefingSeen } from '../src/pages/caseBriefing.js';
import { ADVANCED_NOTE, splitAdvanced } from '../src/skills/coverage.js';
import { FIRST_BLOOD_NOTE } from '../src/pages/socialHelpers.js';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, data };
};

test('challenge copy: practice server wording, flag help, empty-submit hint and category legend', () => {
  assert.match(SERVER_INTRO, /^Start your private practice server\./);
  assert.match(SERVER_INTRO, /shuts down by itself when the timer ends\.$/);
  assert.equal(FLAG_HELP, 'Flags look like CTF{...}. Paste the whole thing.');
  assert.equal(EMPTY_SUBMIT_HINT, 'Type your answer to enable');
  assert.match(CATEGORY_LEGEND, /Pwn = break a program to take control of it/);
  assert.match(CATEGORY_LEGEND, /Crypto = codes and ciphers/);
  assert.match(CATEGORY_LEGEND, /Misc = anything else/);
  // the hosted-mode refusal agrees with the panel: it needs Docker, which runs only locally
  assert.match(challengeErrorMessage({ code: 'DOCKER_DISABLED' }), /practice server.*Docker.*locally/);
});

test('Cipher Lab unlock text spells out the level and keeps the id for lookups', () => {
  assert.equal(levelName('m2'), 'Medium level 2');
  assert.equal(levelName('E1'), 'Easy level 1');
  assert.equal(levelName('h4'), 'Hard level 4');
  assert.equal(levelName('i3'), 'Insane level 3');
  assert.equal(levelName('zz'), 'ZZ');
  assert.equal(levelName(null), '');
  assert.equal(unlockText('m2'), 'Unlocks when you clear Medium level 2');
});

test('Crackme first-move box shows on the first cabinet only; glossary names PC, CMP and JNZ', () => {
  assert.equal(FIRST_MOVE.length, 3);
  assert.match(FIRST_MOVE[1], /Input to test/);
  assert.match(FIRST_MOVE[2], /Submit this input/);
  assert.equal(isFirstCabinet({ track: 'easy', n: 1 }), true);
  assert.equal(isFirstCabinet({ track: 'easy', n: 2 }), false);
  assert.equal(isFirstCabinet({ track: 'medium', n: 1 }), false);
  assert.equal(isFirstCabinet(null), false);
  assert.equal(GLOSSARY, 'PC = which line is running. CMP = compare. JNZ = jump if they differed.');
});

test('Web Lab badge reads "Severity: HIGH · bounty $500"; locked tabs are one line; bounty note is plain', () => {
  assert.equal(badgeText(severityMeta('high'), 500), 'Severity: HIGH · bounty $500');
  assert.equal(badgeText(severityMeta('low'), 1500), 'Severity: LOW · bounty $1,500');
  assert.equal(badgeText(severityMeta('low'), undefined), 'Severity: LOW');
  const need = new Map([['history', 2], ['diff', 3]]);
  assert.equal(lockNote([{ label: 'History', feature: 'history' }, { label: 'Diff', feature: 'diff' }], need), 'Locked tabs open as you solve labs: History after 2, Diff after 3.');
  assert.equal(lockNote([], need), '');
  assert.match(BOUNTY_NOTE, /does not change your points/);
});

test('case briefing: open on the first visit, remembered per user and category, never without an identity', () => {
  const storage = memory();
  assert.equal(briefingKey('A@B.c ', 'osint'), `${BRIEFING_PREFIX}a@b.c:osint`);
  assert.equal(briefingKey('', 'osint'), '');
  assert.equal(isBriefingSeen('a@b.c', 'osint', storage), false);
  assert.equal(markBriefingSeen('a@b.c', 'osint', storage), true);
  assert.equal(isBriefingSeen('a@b.c', 'osint', storage), true);
  assert.equal(isBriefingSeen('a@b.c', 'forensics', storage), false);
  assert.equal(isBriefingSeen('other@b.c', 'osint', storage), false);
  assert.equal(markBriefingSeen('', 'osint', storage), false);
  assert.equal(briefingOpen({ solved: 3, seen: false }), true);
  assert.equal(briefingOpen({ solved: 3, seen: true }), false);
  assert.equal(briefingOpen({ solved: 0, seen: true }), true);
  assert.match(START_HERE.osint, /^Start here:/);
  assert.match(START_HERE.forensics, /^Start here:/);
});

test('skills: readable CTF skill areas first, public frameworks under Advanced', () => {
  const groups = ['owasp', 'attack', 'nice', 'area'].map((id) => ({ framework: { id }, rows: [] }));
  const { primary, advanced } = splitAdvanced(groups);
  assert.deepEqual(primary.map((g) => g.framework.id), ['area']);
  assert.deepEqual(advanced.map((g) => g.framework.id), ['owasp', 'attack', 'nice']);
  assert.deepEqual(splitAdvanced(undefined), { primary: [], advanced: [] });
  assert.ok(ADVANCED_NOTE.length > 20);
  assert.equal(FIRST_BLOOD_NOTE, 'You captured it before anyone else did');
});

test('disabled buttons are flat and calm: no hatching, no dashed border, still muted', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const rule = css.split('\n').find((line) => line.startsWith('button:disabled'));
  assert.ok(rule, 'shared disabled rule exists');
  assert.doesNotMatch(rule, /repeating-linear-gradient|dashed/);
  assert.match(rule, /color: var\(--color-muted\)/);
  assert.match(rule, /background: var\(--color-surface-2\)/);
  assert.match(css, /\.submit-hint \{[^}]*var\(--color-muted\)/);
});
