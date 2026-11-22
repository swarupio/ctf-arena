// The event phase is a pure function of the stored schedule and a clock that the test fixes.
import { describe, expect, it } from 'vitest';
import {
  eventPhase, eventView, normalizeEvent, scoreboardCutoff, submissionBlock, validateSchedule,
} from '../../src/services/eventPhase.js';

const at = (hour, minute = 0, second = 0) => new Date(Date.UTC(2026, 11, 5, hour, minute, second));
const event = { name: 'Winter Cup', startsAt: at(18), endsAt: at(22), freezeAt: at(21) };

describe('eventPhase', () => {
  it('is none without a usable schedule', () => {
    for (const value of [undefined, null, {}, { name: 'x' }, { startsAt: at(18) }, { endsAt: at(22) }, { startsAt: 'nope', endsAt: 'nope' },
      { startsAt: at(22), endsAt: at(18) }, { startsAt: at(18), endsAt: at(18) }]) {
      expect(eventPhase(value, at(19))).toBe('none');
    }
  });

  it('walks upcoming -> live -> frozen -> ended with exact boundaries', () => {
    const cases = [
      [at(17, 59, 59), 'upcoming'], [at(18), 'live'], [at(20, 59, 59), 'live'],
      [at(21), 'frozen'], [at(21, 59, 59), 'frozen'], [at(22), 'ended'], [at(23), 'ended'],
    ];
    for (const [now, phase] of cases) { expect(eventPhase(event, now)).toBe(phase); }
  });

  it('skips frozen when there is no freeze time (or the stored one is outside the window)', () => {
    expect(eventPhase({ ...event, freezeAt: null }, at(21, 30))).toBe('live');
    expect(eventPhase({ ...event, freezeAt: at(23) }, at(21, 30))).toBe('live');
    expect(eventPhase({ ...event, freezeAt: at(17) }, at(19))).toBe('live');
  });

  it('accepts ISO strings and Dates', () => {
    const stored = { startsAt: at(18).toISOString(), endsAt: at(22).toISOString(), freezeAt: at(21).toISOString() };
    expect(eventPhase(stored, at(21, 30).toISOString())).toBe('frozen');
  });
});

describe('normalizeEvent / eventView', () => {
  it('trims the name and drops an invalid freeze', () => {
    expect(normalizeEvent({ ...event, name: '  Cup  ', freezeAt: at(23) })).toEqual({ name: 'Cup', startsAt: at(18), endsAt: at(22), freezeAt: null });
    expect(normalizeEvent(null)).toBeNull();
  });

  it('publishes only name, phase, the three times and serverTime', () => {
    const view = eventView(event, at(19));
    expect(view).toEqual({
      name: 'Winter Cup', phase: 'live', startsAt: at(18).toISOString(), endsAt: at(22).toISOString(),
      freezeAt: at(21).toISOString(), serverTime: at(19).toISOString(),
    });
  });

  it('describes "no event" with nulls', () => {
    expect(eventView(undefined, at(19))).toEqual({ name: '', phase: 'none', startsAt: null, endsAt: null, freezeAt: null, serverTime: at(19).toISOString() });
  });
});

describe('scoreboardCutoff and submissionBlock', () => {
  it('cuts the scoreboard only while frozen', () => {
    expect(scoreboardCutoff(event, at(19))).toBeNull();
    expect(scoreboardCutoff(event, at(21, 30))).toEqual(at(21));
    expect(scoreboardCutoff(event, at(22))).toBeNull();
    expect(scoreboardCutoff(undefined, at(21, 30))).toBeNull();
  });

  it('refuses submissions before the start and after the end only', () => {
    expect(submissionBlock(event, at(17))?.code).toBe('EVENT_NOT_STARTED');
    expect(submissionBlock(event, at(18))).toBeNull();
    expect(submissionBlock(event, at(21, 30))).toBeNull();
    expect(submissionBlock(event, at(22))?.code).toBe('EVENT_ENDED');
    expect(submissionBlock(undefined, at(17))).toBeNull();
    expect(submissionBlock({}, at(17))).toBeNull();
  });
});

describe('validateSchedule', () => {
  it('accepts a good schedule with or without a freeze', () => {
    expect(validateSchedule({ startsAt: at(18), endsAt: at(22), freezeAt: at(21) })).toEqual({});
    expect(validateSchedule({ startsAt: at(18), endsAt: at(22), freezeAt: null })).toEqual({});
  });

  it('reports each problem on its field', () => {
    expect(validateSchedule({ startsAt: null, endsAt: null, freezeAt: null })).toMatchObject({ startsAt: expect.any(String), endsAt: expect.any(String) });
    expect(validateSchedule({ startsAt: at(22), endsAt: at(18), freezeAt: null }).endsAt).toMatch(/after the start/);
    expect(validateSchedule({ startsAt: at(18), endsAt: at(22), freezeAt: at(18) }).freezeAt).toMatch(/between/);
    expect(validateSchedule({ startsAt: at(18), endsAt: at(22), freezeAt: at(22) }).freezeAt).toMatch(/between/);
    expect(validateSchedule({ startsAt: at(18), endsAt: at(22), freezeAt: at(23) }).freezeAt).toMatch(/between/);
  });
});
