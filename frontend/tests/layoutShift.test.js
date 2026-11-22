import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANNER_HINT_KEY, BANNER_HINT_MAX_PX, BANNER_HINT_TTL_MS, readBannerHint, widthClass, writeBannerHint,
} from '../src/components/bannerHint.js';
import { CHECKLIST_HINT_PREFIX, readChecklistHint, writeChecklistHint } from '../src/onboarding/checklistHint.js';

const memory = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    data,
  };
};
const blocked = () => ({
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
  removeItem() { throw new Error('SecurityError'); },
});
const NOW = 1_800_000_000_000;
const opts = (storage, extra = {}) => ({ storage, now: NOW, width: 1280, ...extra });

test('width classes group viewports that wrap text the same way', () => {
  assert.equal(widthClass(390), 'narrow');
  assert.equal(widthClass(600), 'narrow');
  assert.equal(widthClass(601), 'medium');
  assert.equal(widthClass(900), 'medium');
  assert.equal(widthClass(1280), 'wide');
});

test('a banner hint round-trips per kind and survives the other kind changing', () => {
  const storage = memory();
  assert.equal(readBannerHint('announcement', opts(storage)), 0);
  assert.equal(writeBannerHint('announcement', 54, opts(storage)), true);
  assert.equal(writeBannerHint('event', 31.6, opts(storage)), true);
  assert.equal(readBannerHint('announcement', opts(storage)), 54);
  assert.equal(readBannerHint('event', opts(storage)), 32);
  writeBannerHint('announcement', 0, opts(storage));
  assert.equal(readBannerHint('announcement', opts(storage)), 0);
  assert.equal(readBannerHint('event', opts(storage)), 32);
  writeBannerHint('event', 0, opts(storage));
  assert.equal(storage.data.has(BANNER_HINT_KEY), false, 'nothing is left behind when no bar was seen');
});

test('a banner hint is ignored when stale, from another width class or from the future', () => {
  const storage = memory();
  writeBannerHint('announcement', 60, opts(storage));
  assert.equal(readBannerHint('announcement', opts(storage, { now: NOW + BANNER_HINT_TTL_MS })), 60);
  assert.equal(readBannerHint('announcement', opts(storage, { now: NOW + BANNER_HINT_TTL_MS + 1 })), 0);
  assert.equal(readBannerHint('announcement', opts(storage, { width: 390 })), 0);
  assert.equal(readBannerHint('announcement', opts(storage, { now: NOW - 3_600_000 })), 0);
});

test('a banner hint is capped and rejects unknown kinds and odd heights', () => {
  const storage = memory();
  writeBannerHint('announcement', 5000, opts(storage));
  assert.equal(readBannerHint('announcement', opts(storage)), BANNER_HINT_MAX_PX);
  assert.equal(writeBannerHint('nope', 40, opts(storage)), false);
  assert.equal(readBannerHint('nope', opts(storage)), 0);
  writeBannerHint('event', Number.NaN, opts(storage));
  writeBannerHint('event', -4, opts(storage));
  assert.equal(readBannerHint('event', opts(storage)), 0);
});

test('a corrupt banner hint reads as nothing and the next write repairs it', () => {
  for (const bad of ['not json', '[]', '"x"', '{"announcement":"big"}', '{"announcement":{"px":"60","at":1,"w":"wide"}}',
    JSON.stringify({ announcement: { px: -5, at: NOW, w: 'wide' } }), JSON.stringify({ announcement: null })]) {
    const storage = memory({ [BANNER_HINT_KEY]: bad });
    assert.equal(readBannerHint('announcement', opts(storage)), 0, bad);
    assert.equal(writeBannerHint('announcement', 48, opts(storage)), true);
    assert.equal(readBannerHint('announcement', opts(storage)), 48, bad);
  }
});

test('blocked storage never throws and reserves nothing', () => {
  assert.equal(readBannerHint('announcement', opts(blocked())), 0);
  assert.equal(writeBannerHint('announcement', 48, opts(blocked())), false);
  assert.equal(readBannerHint('announcement', opts(null)), 0);
  assert.equal(writeBannerHint('announcement', 48, opts(null)), false);
  assert.equal(readChecklistHint('a@b.c', blocked()), '');
  assert.equal(writeChecklistHint('a@b.c', 'cleared', blocked()), false);
});

test('the checklist hint is kept per user and only holds the two known states', () => {
  const storage = memory();
  assert.equal(readChecklistHint('Ada@Example.com', storage), '');
  assert.equal(writeChecklistHint('Ada@Example.com', 'cleared', storage), true);
  assert.equal(readChecklistHint(' ada@example.com ', storage), 'cleared', 'same account whatever the case');
  assert.equal(readChecklistHint('bob@example.com', storage), '', 'a second account in the browser does not inherit it');
  assert.equal(writeChecklistHint('ada@example.com', 'open', storage), true);
  assert.equal(readChecklistHint('ada@example.com', storage), 'open');
  assert.equal(writeChecklistHint('ada@example.com', 'maybe', storage), false);
  assert.equal(readChecklistHint('ada@example.com', storage), 'open');
});

test('the checklist hint is never read or written for a signed-out visitor', () => {
  const storage = memory({ [`${CHECKLIST_HINT_PREFIX}`]: 'cleared' });
  assert.equal(readChecklistHint('', storage), '');
  assert.equal(readChecklistHint(undefined, storage), '');
  assert.equal(writeChecklistHint(null, 'cleared', storage), false);
  assert.equal(storage.data.size, 1);
});

test('a corrupt checklist hint reads as unknown', () => {
  for (const bad of ['{"x":1}', '', 'CLEARED', '1', 'null']) {
    const storage = memory({ [`${CHECKLIST_HINT_PREFIX}a@b.c`]: bad });
    assert.equal(readChecklistHint('a@b.c', storage), '', bad);
  }
});
