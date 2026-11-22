// Scheduled event: countdown logic, clock offset, accessible announcement text, admin form logic and the EVENT_* messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeErrorMessage } from '../src/pages/challengeHelpers.js';
import { cipherErrorMessage } from '../src/components/cipherlab/helpers.js';
import { crackmeErrorMessage } from '../src/components/crackme/helpers.js';
import { describeForensicsError } from '../src/forensics/caseHelpers.js';
import { describeOsintError } from '../src/osint/helpers.js';
import { describeBoardError } from '../src/osint/board.js';
import { describeError as describeTerminalError } from '../src/terminal/adapters.js';
import { describeError as describeWeblabError } from '../src/components/weblab/helpers.js';
import {
  CLEAR_EVENT_BODY, eventBody, eventDirty, eventToDraft, fromLocalInput, isBlankDraft, toLocalInput, validateEventDraft,
} from '../src/admin/eventForm.js';
import {
  bannerState, clockOffset, clockText, formatRemaining, phaseAt, spokenRemaining,
} from '../src/event/logic.js';
import { EVENT_MESSAGES, eventMessage } from '../src/event/messages.js';

const at = (hour, minute = 0, second = 0) => Date.UTC(2030, 11, 5, hour, minute, second);
const iso = (value) => new Date(value).toISOString();
const event = { name: 'Winter Cup', startsAt: iso(at(18)), endsAt: iso(at(22)), freezeAt: iso(at(21)), phase: 'live' };

test('phaseAt follows the server rules at the boundaries', () => {
  const cases = [
    [at(17, 59, 59), 'upcoming'], [at(18), 'live'], [at(20, 59, 59), 'live'], [at(21), 'frozen'], [at(22), 'ended'], [at(23), 'ended'],
  ];
  for (const [now, phase] of cases) assert.equal(phaseAt(event, now), phase);
  assert.equal(phaseAt({ ...event, freezeAt: null }, at(21, 30)), 'live');
  assert.equal(phaseAt({ ...event, freezeAt: iso(at(23)) }, at(21, 30)), 'live');
  for (const bad of [null, undefined, {}, { startsAt: event.startsAt }, { startsAt: event.endsAt, endsAt: event.startsAt }]) {
    assert.equal(phaseAt(bad, at(19)), 'none');
  }
});

test('clockOffset corrects a wrong client clock', () => {
  const clientNow = at(10);
  const offset = clockOffset(iso(at(12)), clientNow);
  assert.equal(offset, 2 * 3_600_000);
  assert.equal(phaseAt(event, clientNow + offset), 'upcoming');
  assert.equal(clockOffset('garbage', clientNow), 0);
  assert.equal(clockOffset(undefined, clientNow), 0);
});

test('formatRemaining pads, shows days and never goes negative', () => {
  assert.equal(formatRemaining(((2 * 60 + 13) * 60 + 5) * 1000), '02:13:05');
  assert.equal(formatRemaining(999), '00:00:00');
  assert.equal(formatRemaining(-5000), '00:00:00');
  assert.equal(formatRemaining((3 * 86400 + 3725) * 1000), '3d 01:02:05');
});

test('spokenRemaining uses whole minutes and plurals', () => {
  assert.equal(spokenRemaining(30_000), 'less than a minute');
  assert.equal(spokenRemaining(60_000), '1 minute');
  assert.equal(spokenRemaining(((2 * 60) + 13) * 60_000), '2 hours 13 minutes');
  assert.equal(spokenRemaining((26 * 60 + 1) * 60_000), '1 day 2 hours 1 minute');
});

test('bannerState shows each phase and is hidden without an event', () => {
  assert.equal(bannerState(null, at(19)), null);
  assert.equal(bannerState({}, at(19)), null);
  const upcoming = bannerState(event, at(15, 46, 55));
  assert.equal(upcoming.text, 'Winter Cup — starts in 02:13:05');
  assert.equal(upcoming.phase, 'upcoming');
  const live = bannerState(event, at(19));
  assert.equal(live.text, 'Winter Cup — live — ends in 03:00:00');
  const frozen = bannerState(event, at(21, 30));
  assert.equal(frozen.text, 'Winter Cup — scoreboard frozen — ends in 00:30:00');
  const ended = bannerState(event, at(22, 1));
  assert.equal(ended.text, 'Winter Cup — ended');
  assert.equal(ended.countdown, null);
  assert.equal(bannerState({ ...event, name: '  ' }, at(19)).name, 'Arena event');
});

test('the spoken announcement changes only on a phase or minute change, never per second', () => {
  const announce = (now) => bannerState(event, now).announce;
  assert.equal(announce(at(15, 46, 55)), announce(at(15, 46, 56)));
  assert.equal(announce(at(15, 46, 1)), announce(at(15, 46, 59)));
  assert.notEqual(announce(at(15, 46, 1)), announce(at(15, 47, 1)));
  assert.notEqual(announce(at(17, 59)), announce(at(18, 1)));
  assert.match(announce(at(15, 46, 55)), /starts in 2 hours 13 minutes/);
  assert.doesNotMatch(announce(at(19)), /\d\d:\d\d:\d\d/);
  assert.match(bannerState(event, at(23)).announce, /ended/);
});

test('clockText renders a short time in a given zone', () => {
  assert.equal(clockText(iso(at(21)), { locale: 'en-GB', timeZone: 'UTC' }), '21:00');
  assert.equal(clockText('nope'), '');
});

test('local datetime inputs round-trip to UTC ISO strings', () => {
  const local = new Date(2030, 11, 5, 18, 30);
  const text = toLocalInput(local.toISOString());
  assert.equal(text, '2030-12-05T18:30');
  assert.equal(fromLocalInput(text), local.toISOString());
  assert.equal(toLocalInput(''), '');
  assert.equal(toLocalInput('garbage'), '');
  for (const bad of ['', null, '2030-12-05', '2030-13-05T10:00', '2030-02-31T10:00', 'tomorrow', '2030-12-05T25:00']) {
    assert.equal(fromLocalInput(bad), null);
  }
});

const draft = (overrides = {}) => ({
  name: 'Winter Cup', startsAt: '2030-12-05T18:00', endsAt: '2030-12-05T22:00', freezeAt: '2030-12-05T21:00', ...overrides,
});

test('validateEventDraft accepts a good schedule and a blank (disabled) one', () => {
  assert.deepEqual(validateEventDraft(draft()), {});
  assert.deepEqual(validateEventDraft(draft({ freezeAt: '', name: '' })), {});
  assert.deepEqual(validateEventDraft({ name: '', startsAt: '', endsAt: '', freezeAt: '' }), {});
  assert.equal(isBlankDraft({ name: ' ', startsAt: '', endsAt: '', freezeAt: '' }), true);
});

test('validateEventDraft explains each problem on its field', () => {
  assert.match(validateEventDraft(draft({ startsAt: '' })).startsAt, /start/);
  assert.match(validateEventDraft(draft({ endsAt: '' })).endsAt, /end/);
  assert.match(validateEventDraft(draft({ startsAt: '2030-12-05T23:00' })).endsAt, /after the start/);
  assert.match(validateEventDraft(draft({ endsAt: '2030-12-05T18:00' })).endsAt, /after the start/);
  for (const freezeAt of ['2030-12-05T17:00', '2030-12-05T18:00', '2030-12-05T22:00', '2030-12-06T00:00']) {
    assert.match(validateEventDraft(draft({ freezeAt })).freezeAt, /between the start and the end/);
  }
  assert.match(validateEventDraft(draft({ name: 'x'.repeat(81) })).name, /80/);
  assert.match(validateEventDraft(draft({ startsAt: '2030-02-31T10:00' })).startsAt, /valid/);
});

test('eventBody sends UTC ISO strings and null for a missing freeze; clearing sends null', () => {
  const body = eventBody(draft({ name: '  Winter Cup ', freezeAt: '' }));
  assert.equal(body.event.name, 'Winter Cup');
  assert.equal(body.event.startsAt, fromLocalInput('2030-12-05T18:00'));
  assert.equal(body.event.freezeAt, null);
  assert.match(body.event.endsAt, /Z$/);
  assert.deepEqual(CLEAR_EVENT_BODY, { event: null });
});

test('eventDirty compares against the saved schedule', () => {
  const saved = { name: 'Winter Cup', startsAt: fromLocalInput('2030-12-05T18:00'), endsAt: fromLocalInput('2030-12-05T22:00'), freezeAt: fromLocalInput('2030-12-05T21:00') };
  assert.equal(eventDirty(saved, eventToDraft(saved)), false);
  assert.equal(eventDirty(saved, { ...eventToDraft(saved), name: 'Other' }), true);
  assert.equal(eventDirty(saved, { ...eventToDraft(saved), freezeAt: '' }), true);
  assert.equal(eventDirty(null, { name: '', startsAt: '', endsAt: '', freezeAt: '' }), false);
  assert.equal(eventDirty(null, draft()), true);
});

test('eventMessage maps only the two event codes', () => {
  assert.equal(eventMessage({ code: 'EVENT_NOT_STARTED' }), EVENT_MESSAGES.EVENT_NOT_STARTED);
  assert.equal(eventMessage({ code: 'EVENT_ENDED' }), EVENT_MESSAGES.EVENT_ENDED);
  assert.equal(eventMessage({ code: 'SUBMISSIONS_FROZEN' }), null);
  assert.equal(eventMessage({ code: 'toString' }), null);
  assert.equal(eventMessage(undefined), null);
});

test('every submit form shows the EVENT_* messages through its own error helper', () => {
  for (const code of ['EVENT_NOT_STARTED', 'EVENT_ENDED']) {
    const error = { code, status: 423, message: 'server text' };
    const expected = EVENT_MESSAGES[code];
    assert.equal(challengeErrorMessage(error), expected);
    assert.equal(cipherErrorMessage(error), expected);
    assert.equal(crackmeErrorMessage(error), expected);
    assert.equal(describeForensicsError(error), expected);
    assert.equal(describeOsintError(error), expected);
    assert.equal(describeBoardError(error), expected);
    assert.equal(describeTerminalError(error, 'submit').message, expected.toLowerCase());
    assert.equal(describeWeblabError(error).message, expected);
  }
});
