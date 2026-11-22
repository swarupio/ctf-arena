const secret = 's'.repeat(32);
const B = require('url').pathToFileURL(require('path').resolve(__dirname, '../../backend/src')).href + '/';
async function makeHandler(fallback) {
  const CL = { lv: await import(B + 'games/cipherlab/levels.js'), game: await import(B + 'games/cipherlab/game.js') };
  const CM = { lv: await import(B + 'games/crackme/levels.js'), game: await import(B + 'games/crackme/game.js'), rules: await import(B + 'games/crackme/patch.js') };
  const WL = await import(B + 'games/weblab/index.js');
  const F = await import(B + 'forensics/tracks.js');
  const FI = await import(B + 'forensics/interviews.js');
  const O = { C: await import(B + 'osint/cases.js'), B: await import(B + 'osint/board.js'), E: await import(B + 'osint/evidence.js'), S: await import(B + 'osint/sources.js') };

  // ---------- data builders
  const clView = (id) => {
    const level = CL.lv.levelById(id); const built = CL.game.buildPuzzle(level, { secret, teamId: 't' }); const track = CL.lv.TRACKS.find((t) => t.id === level.track);
    const texts = track.hints ? CL.game.hintTexts(level, built) : [];
    return { id, track: level.track, n: level.n, title: level.title, briefing: level.briefing, points: level.points, boss: !!level.boss, status: 'open', ...CL.game.publicPuzzle(built), hintsAllowed: track.hints, hintsTotal: texts.length, hints: texts.slice(0, 1) };
  };
  const clOverview = () => ({ toolbox: CL.lv.TOOLS.map((t) => ({ ...t, unlocked: true })), streak: 3, tracks: [], levels: [] });
  const cmView = (id) => {
    const level = CM.lv.levelById(id); const built = CM.game.buildPuzzle(level, { secret, teamId: 't' });
    return { id, track: level.track, n: level.n, title: level.title, briefing: level.briefing, points: level.points, boss: !!level.boss, status: 'open', ...CM.game.publicPuzzle(built), hintsAllowed: level.track !== 'insane', hintsTotal: 2, hints: ['Look at the first compare.'],
      ...(CM.rules.isPatchable(level) ? { patchBay: { maxEdits: CM.rules.PATCH_MAX_EDITS, rules: CM.rules.PATCH_RULES, tests: 6, steps: 20000, done: false } } : {}) };
  };
  const wlSumm = (lab, solved) => ({ id: lab.id, slug: 'weblab-' + lab.id, title: lab.title, summary: lab.summary, track: lab.track, boss: !!lab.boss, points: lab.points, hintCount: lab.hints.length, available: true, solved: solved.has(lab.id), pointsEarned: 0, locked: false, lockedReason: null, severity: null, bountyUsd: null });
  const wlDetail = (slug) => { const lab = WL.LABS.find((l) => 'weblab-' + l.id === slug); const t = WL.TRACKS.find((x) => x.id === lab.track); return { ...wlSumm(lab, new Set()), objective: lab.objective, story: lab.story, company: t.company, theme: t.theme, site: lab.site, form: lab.form ?? null, request: WL.labTemplate(lab, { secret, teamId: 't' }), inspector: WL.inspectorFor(1) }; };
  const fview = (id) => {
    const track = F.TRACKS[id]; const ctx = F.makeContext(id, secret, 't'); const su = F.suspectsFor(ctx).suspects; const solved = new Set([1, 2]);
    return { id, title: track.title, caseTitle: track.caseTitle, difficulty: track.difficulty, tagline: track.tagline, briefing: track.briefing, artefacts: track.artefacts, maxPoints: track.maxPoints,
      stages: track.stages.map((s) => ({ n: s.n, title: s.title, prompt: s.prompt, points: s.points, format: F.answerFormat(s), hint: s.hint, whodunit: !!s.whodunit, solved: solved.has(s.n), locked: !!s.whodunit, available: true, ...(solved.has(s.n) ? { pointsEarned: s.points, flag: 'CTF{forensics_x_1_abcdef123456}' } : {}) })),
      evidence: [...solved].map((n) => ({ n, title: track.stages[n - 1].title, value: F.answerOf(ctx, n) })),
      suspects: su.map((x) => ({ id: x.id, name: x.name, role: x.role, facts: x.facts.map((f) => ({ label: f.label, stage: f.stage, value: solved.has(f.stage) ? f.value : null })) })),
      solved: 2, total: 5, pointsEarned: 30, caseClosed: false };
  };
  const boards = {};
  const oCase = (t) => O.C.buildCase(secret, 'team-shot', t);
  const oBoardView = (track) => {
    const d = oCase(track); const idx = O.B.evidenceIndex(d.world); const doc = boards[track] ?? { version: 0, pins: [], links: [], unlocked: false };
    const prog = O.B.chainProgress(d.chain, doc.links);
    return { version: doc.version, pins: doc.pins.map((p) => ({ ...p, kind: idx.get(p.id).kind, label: idx.get(p.id).label })), links: doc.links, progress: { found: doc.unlocked ? d.chain.length : prog.found, total: d.chain.length }, unlocked: doc.unlocked,
      nudge: O.B.nudge({ ...prog, unlocked: doc.unlocked }), limits: { pins: O.B.MAX_PINS, links: O.B.linkCap(d.chain.length), size: 1000 }, relations: O.E.RELATIONS, readOnly: false };
  };
  const oCaseView = (track) => {
    const t = O.C.TRACKS[track]; const d = oCase(track);
    return { id: track, title: t.title, caseTitle: t.caseTitle, difficulty: t.difficulty, tagline: t.tagline, story: t.story(d.pub), hintsAllowed: t.hintsAllowed, maxPoints: t.maxPoints,
      questions: t.stages.map((s, i) => ({ n: s.n, title: s.title, prompt: s.prompt(d.pub), points: s.points, format: O.C.answerFormat(s), kind: s.kind, final: s.final, solved: i === 0, locked: s.final, available: true, hintsTotal: t.hintsAllowed ? 2 : 0, hints: t.hintsAllowed && i === 1 ? ['Check the registry first.'] : [], ...(i === 0 ? { pointsEarned: s.points, confirmed: 'x' } : {}), ...(s.final ? { lockedBy: 'board' } : {}) })),
      sources: [], town: 'x', company: 'x', solved: 1, total: t.stages.length, pointsEarned: 10, caseClosed: false, board: { required: d.chain.length, unlocked: false } };
  };
  const modes = [{ mode: 'easy', title: 'Easy', tagline: 't', difficulty: 'easy', codes: 8, solved: 2, points: 100, pointsEarned: 20, lore: ['You wake up in a shell.'] }, { mode: 'medium', title: 'Medium', tagline: 't', difficulty: 'medium', codes: 8, solved: 0, points: 300, pointsEarned: 0, lore: [] }, { mode: 'hard', title: 'Hard', tagline: 't', difficulty: 'hard', codes: 8, solved: 0, points: 600, pointsEarned: 0, lore: [] }];
  const termProgress = { mode: 'easy', total: 8, solved: [{ n: 1, title: 'First steps', points: 10, firstBlood: true }, { n: 2, title: 'Hidden file', points: 10, firstBlood: false }], remaining: [{ n: 3, points: 10 }, { n: 4, points: 15 }, { n: 5, points: 15 }, { n: 6, points: 20 }, { n: 7, points: 20 }, { n: 8, points: 20 }] };

  const json = (req, status, body) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const handler = (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith('/api/')) { return req.continue(); }
    const p = u.pathname.slice(4); const q = Object.fromEntries(u.searchParams); let m;
    // cipherlab
    if (p === '/cipherlab/overview') { return json(req, 200, clOverview()); }
    if ((m = /^\/cipherlab\/levels\/(\w+)$/.exec(p))) { return json(req, 200, clView(m[1])); }
    // crackme
    if ((m = /^\/crackme\/levels\/(\w+)$/.exec(p))) { return json(req, 200, cmView(m[1])); }
    // weblab
    if (p === '/weblab/labs') { return json(req, 200, { tracks: WL.TRACKS.map((t) => ({ id: t.id, title: t.title, difficulty: t.difficulty, theme: t.theme, company: t.company, labs: t.labs.map((l) => wlSumm(WL.LABS.find((x) => x.id === l.id), new Set())), solved: 0, total: t.labs.length, points: 100, pointsEarned: 0, cleared: false })), totals: { labs: 10, solved: 0, points: 1470, pointsEarned: 0, bountyUsd: 0 }, inspector: WL.inspectorFor(1) }); }
    if (/^\/weblab\/labs\/[^/]+$/.test(p)) { return json(req, 200, wlDetail(p.split('/').pop())); }
    if (/^\/weblab\/labs\/[^/]+\/request$/.test(p)) { const lab = WL.LABS.find((l) => 'weblab-' + l.id === p.split('/')[3]); return json(req, 200, { ...WL.runLab(lab, { secret, teamId: 't', flag: 'CTF{demo}', request: JSON.parse(req.postData()) }), hint: null }); }
    // forensics
    if (/^\/forensics\/tracks\/\w+$/.test(p)) { return json(req, 200, fview(p.split('/').pop())); }
    if (/\/interviews$/.test(p)) { const id = p.split('/')[3]; const ctx = F.makeContext(id, secret, 't'); return json(req, 200, { questions: FI.interviewQuestions(ctx, new Set([1, 2])).map(({ id: i, stage, text }) => ({ id: i, stage, text })), suspects: F.suspectsFor(ctx).suspects.map((s) => ({ id: s.id, name: s.name, role: s.role })) }); }
    if (/artefacts/.test(p)) { const parts = p.split('/'); const ctx = F.makeContext(parts[3], secret, 't'); return json(req, 200, F.artefactData(ctx, parts[5], { offset: +(q.offset || 0), limit: +(q.limit || 200), cluster: q.cluster === undefined ? undefined : +q.cluster, count: +(q.count || 1), image: +(q.image || 1) })); }
    // osint
    const tr = (p.match(/^\/osint\/cases\/(\w+)/) || [])[1];
    if (tr) {
      if (/\/board\/evidence$/.test(p)) {
        const d = oCase(tr); const all = O.B.evidenceOf(d.world).filter((i) => (!q.source || i.kind === q.source) && (!q.q || i.label.toLowerCase().includes(q.q.toLowerCase())));
        const off = +(q.offset || 0); const lim = +(q.limit || 20);
        return json(req, 200, { total: all.length, offset: off, limit: lim, items: all.slice(off, off + lim) });
      }
      if (/\/board$/.test(p)) {
        if (req.method() === 'PUT') {
          const body = JSON.parse(req.postData()); const doc = boards[tr] ?? { version: 0, pins: [], links: [], unlocked: false }; const d = oCase(tr);
          const bad = O.B.boardProblem({ index: O.B.evidenceIndex(d.world), pins: body.pins, links: body.links, required: d.chain.length });
          if (bad) { return json(req, 400, { error: bad }); }
          const prog = O.B.chainProgress(d.chain, body.links);
          boards[tr] = { version: doc.version + 1, pins: body.pins, links: body.links, unlocked: doc.unlocked || prog.found === prog.total };
          return json(req, 200, oBoardView(tr));
        }
        return json(req, 200, oBoardView(tr));
      }
      if (/\/search$/.test(p)) { return json(req, 200, O.S.searchCorpus(oCase(tr).world, q.q, { offset: +(q.offset || 0), limit: +(q.limit || 10) })); }
      if (/\/sources\//.test(p)) { return json(req, 200, O.S.listSource(oCase(tr).world, p.split('/').pop(), { offset: +(q.offset || 0), limit: q.limit ? +q.limit : undefined, author: q.author, date: q.date })); }
      if (/^\/osint\/cases\/\w+$/.test(p)) { return json(req, 200, oCaseView(tr)); }
    }
    // terminal
    if (p === '/terminal/modes') { return json(req, 200, modes); }
    if (/\/terminal\/\w+\/progress$/.test(p)) { return json(req, 200, termProgress); }
    if (/\/exec$/.test(p)) { return json(req, 200, { output: 'drwxr-xr-x  2 novi novi 4096 Jan  1 00:00 documents\n-rw-r--r--  1 novi novi  220 Jan  1 00:00 a_very_long_file_name_that_should_wrap_or_scroll_inside_the_terminal_without_breaking_the_page_layout_at_all.txt\n' + 'x'.repeat(200), cwd: '/home/novi', exit: 0 }); }
    if (/\/complete$/.test(p)) { return json(req, 200, { matches: [] }); }
    return fallback(req, p);
  };

  return require('./hintfix.cjs').wrap(handler); }
module.exports = { makeHandler };
