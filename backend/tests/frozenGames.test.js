// Read-only mode (admin submissionsFrozen) must stop every game's answer route before any write or attempt is
// consumed. The game services are mocked: the assertion is that a frozen platform never reaches them.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import { assertSubmissionsOpen } from '../src/services/adminSettings.js';
import { getTeamContext } from '../src/services/teamContext.js';
import * as cipherlab from '../src/games/cipherlab/service.js';
import * as crackme from '../src/games/crackme/service.js';
import * as forensics from '../src/services/forensicsService.js';
import * as osint from '../src/services/osintService.js';
import * as weblab from '../src/services/weblabService.js';
import { AppError } from '../src/utils/AppError.js';

vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../src/services/adminSettings.js', () => ({ assertSubmissionsOpen: vi.fn() }));
vi.mock('../src/services/teamContext.js', () => ({ getTeamContext: vi.fn() }));
vi.mock('../src/services/integrityService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, integrityService: { ...actual.integrityService, checkSubmittedFlag: vi.fn() } };
});
vi.mock('../src/games/cipherlab/service.js', () => ({
  loadGame: vi.fn(), findEntry: vi.fn(), submitAnswer: vi.fn(),
}));
vi.mock('../src/games/crackme/service.js', () => ({
  loadGame: vi.fn(), findEntry: vi.fn(), submitAnswer: vi.fn(),
}));
vi.mock('../src/services/forensicsService.js', () => ({ loadRows: vi.fn(), submitAnswer: vi.fn() }));
vi.mock('../src/services/osintService.js', () => ({ loadRows: vi.fn(), submitAnswer: vi.fn() }));
vi.mock('../src/services/weblabService.js', () => ({
  loadRows: vi.fn(), teamProgress: vi.fn(), requireOpen: vi.fn(), submitFlag: vi.fn(),
}));

const routes = [
  ['cipherlab answer', '/api/cipherlab/levels/a1/answer', { answer: 'x' }, cipherlab.submitAnswer],
  ['crackme answer', '/api/crackme/levels/a1/answer', { answer: 'x' }, crackme.submitAnswer],
  ['weblab submit', '/api/weblab/labs/weblab-cookie-tamper/submit', { flag: 'CTF{x}' }, weblab.submitFlag],
  ['forensics answer', '/api/forensics/tracks/easy/stages/1/answer', { answer: 'x' }, forensics.submitAnswer],
  ['osint answer', '/api/osint/cases/easy/questions/1/answer', { answer: 'x' }, osint.submitAnswer],
];

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async () => ({ sub: 'p1', email: 'p1@example.com', 'cognito:groups': ['player'] })),
  });
  getTeamContext.mockResolvedValue({ user: { _id: 'u1' }, team: { _id: 't1' } });
  cipherlab.loadGame.mockResolvedValue([]);
  cipherlab.findEntry.mockReturnValue({});
  crackme.loadGame.mockResolvedValue([]);
  crackme.findEntry.mockReturnValue({});
  forensics.loadRows.mockResolvedValue(new Map());
  osint.loadRows.mockResolvedValue(new Map());
  weblab.loadRows.mockResolvedValue(new Map());
  weblab.teamProgress.mockResolvedValue(new Map());
  weblab.requireOpen.mockReturnValue({});
  for (const [, , , service] of routes) { service.mockResolvedValue({ correct: true }); }
});

describe.each(routes)('%s', (name, path, body, service) => {
  const post = () => request(app).post(path).set('Authorization', 'Bearer p1').send(body);

  it('answers 423 SUBMISSIONS_FROZEN and records nothing while frozen', async () => {
    assertSubmissionsOpen.mockRejectedValue(new AppError(423, 'SUBMISSIONS_FROZEN', 'Submissions are frozen by the organisers.'));
    const res = await post();
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('SUBMISSIONS_FROZEN');
    expect(service).not.toHaveBeenCalled();
  });

  it('is unchanged when not frozen', async () => {
    assertSubmissionsOpen.mockResolvedValue(undefined);
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ correct: true });
    expect(service).toHaveBeenCalledTimes(1);
  });

  it('still validates the body first (400, no settings read)', async () => {
    const res = await request(app).post(path).set('Authorization', 'Bearer p1').send({});
    expect(res.status).toBe(400);
    expect(assertSubmissionsOpen).not.toHaveBeenCalled();
  });
});
