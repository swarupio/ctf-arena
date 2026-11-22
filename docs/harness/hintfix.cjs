// Hint-cost fixtures for the stub harness (docs/HINTS.md "Hint costs"). wrap(handler) answers the hint-open calls and adds
// hintPricing / hintSpent (the backend phase 2 shapes) to the level views of every category, with the default prices 5/10/25/40.
// State lives in this process: opened[key] = Set of 0-based hint indexes. FREE=1 in the environment makes every hint free.
const COSTS = process.env.FREE ? { enabled: false, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40 } : { enabled: true, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40 };
const TIERS = ['nudge', 'approach', 'walkthrough'];
const opened = {};
const pointsOf = (base, percent) => { const p = Math.round(base * percent / 100); return p === 0 && percent > 0 && base >= 10 ? 1 : p; };
const costOf = (base, index) => { const tier = TIERS[Math.min(index, 2)]; const percent = COSTS.enabled ? COSTS[tier] : 0; return { percent, points: percent > 0 ? pointsOf(base, percent) : 0, tier }; };
const spentOf = (base, set) => {
  const cap = Math.round(base * COSTS.maxPercent / 100);
  const raw = [...set].reduce((sum, index) => sum + costOf(base, index).points, 0);
  const points = Math.min(raw, cap);
  return { points, percent: base > 0 ? Math.round(points * 100 / base) : 0, cap };
};
const closed = (base, total, set) => Array.from({ length: total }, (_, index) => index).filter((index) => !set.has(index)).map((index) => ({ index, ...costOf(base, index) }));
const set = (key) => (opened[key] ??= new Set());
const bases = {};
const baseOf = (key, fallback) => bases[key] ?? fallback;

function patch(path, body) {
  let m;
  if ((m = /^\/(cipherlab|crackme)\/levels\/(\w+)$/.exec(path)) && body.hintsAllowed) {
    const key = `${m[1]}:${m[2]}`; const s = set(key); bases[key] = body.points;
    if (s.size === 0 && body.hints?.length) { for (let i = 0; i < body.hints.length; i += 1) { s.add(i); } }
    return { ...body, hints: Array.from({ length: s.size }, (_, i) => body.hints?.[i] ?? `Stub hint ${i + 1}: look at the first step again.`), hintPricing: closed(body.points, body.hintsTotal, s), hintSpent: spentOf(body.points, s) };
  }
  if ((m = /^\/weblab\/labs\/([^/]+)$/.exec(path)) && body.hintCount > 0) {
    const s = set(`weblab:${m[1]}`); bases[`weblab:${m[1]}`] = body.points;
    return { ...body, hintsOpened: [...s].map((i) => i + 1), hintPricing: closed(body.points, body.hintCount, s), hintSpent: spentOf(body.points, s) };
  }
  if ((m = /^\/osint\/cases\/(\w+)$/.exec(path)) && body.questions) {
    return { ...body, questions: body.questions.map((q) => {
      if (!(q.hintsTotal > 0) || q.solved) { return q; }
      const s = set(`osint:${m[1]}:${q.n}`); bases[`osint:${m[1]}:${q.n}`] = q.points;
      if (s.size === 0 && q.hints.length) { for (let i = 0; i < q.hints.length; i += 1) { s.add(i); } }
      return { ...q, hints: q.hints.slice(0, s.size), hintPricing: closed(q.points, q.hintsTotal, s), hintSpent: spentOf(q.points, s) };
    }) };
  }
  if ((m = /^\/forensics\/tracks\/(\w+)$/.exec(path)) && body.stages) {
    return { ...body, stages: body.stages.map((st) => {
      if (st.solved || !st.hint) { return st; }
      const s = set(`forensics:${m[1]}:${st.n}`); bases[`forensics:${m[1]}:${st.n}`] = st.points;
      return { ...st, hint: s.has(0) ? st.hint : null, hasHint: true, hintOpened: s.has(0), hintPricing: closed(st.points, 1, s), hintSpent: spentOf(st.points, s) };
    }) };
  }
  if ((m = /^\/terminal\/(\w+)\/progress$/.exec(path))) {
    const s = set(`terminal:${m[1]}:3`);
    return { ...body, hint: { code: 3, total: 3, base: 40, opened: [...s].map((i) => i + 1), pricing: closed(40, 3, s), spent: spentOf(40, s) } };
  }
  return body;
}

function wrap(handler) {
  return (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith('/api/')) { return handler(req); }
    const path = u.pathname.slice(4);
    const json = (body) => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    let m;
    if (path === '/hint-costs') { return json(COSTS); }
    if (req.method() === 'POST' && (m = /^\/(cipherlab|crackme)\/levels\/(\w+)\/hints$/.exec(path))) {
      const base = baseOf(`${m[1]}:${m[2]}`, 100); const s = set(`${m[1]}:${m[2]}`); const index = s.size; s.add(index);
      return json({ index, hint: `Stub hint ${index + 1}: look at the first step again.`, used: s.size, total: 3, cost: costOf(base, index), spent: spentOf(base, s) });
    }
    if (req.method() === 'POST' && (m = /^\/osint\/cases\/(\w+)\/questions\/(\d+)\/hints$/.exec(path))) {
      const base = baseOf(`osint:${m[1]}:${m[2]}`, 50); const s = set(`osint:${m[1]}:${m[2]}`); const index = s.size; s.add(index);
      return json({ index, hint: `Stub hint ${index + 1}: check the registry first.`, used: s.size, total: 2, cost: costOf(base, index), spent: spentOf(base, s) });
    }
    if (req.method() === 'POST' && (m = /^\/forensics\/tracks\/(\w+)\/stages\/(\d+)\/hint$/.exec(path))) {
      const base = baseOf(`forensics:${m[1]}:${m[2]}`, 50); const s = set(`forensics:${m[1]}:${m[2]}`); s.add(0);
      return json({ index: 0, hint: 'Stub hint: open the evidence in the viewer.', used: 1, total: 1, cost: costOf(base, 0), spent: spentOf(base, s) });
    }
    if ((m = /^\/weblab\/labs\/([^/]+)\/hints\/(\d+)$/.exec(path))) {
      const base = baseOf(`weblab:${m[1]}`, 150); const s = set(`weblab:${m[1]}`); const index = Number(m[2]) - 1; s.add(index);
      return json({ level: index + 1, count: 2, text: `Stub hint ${index + 1}: read the cookie value.`, cost: costOf(base, index), spent: spentOf(base, s) });
    }
    if (req.method() === 'POST' && (m = /^\/terminal\/(\w+)\/exec$/.exec(path)) && /"command":"hint( \d+)?"/.test(req.postData() || '')) {
      const tier = Number(/hint (\d+)/.exec(req.postData())?.[1] ?? 1); set(`terminal:${m[1]}:3`).add(tier - 1);
      return json({ output: `[hint ${tier}/3 for code 3] Stub hint ${tier}: try ls -la.\n`, cwd: '/home/novi', exit: 0 });
    }
    const proxy = new Proxy(req, {
      get(target, key) {
        if (key === 'respond') {
          return (response) => {
            try {
              const parsed = JSON.parse(response.body);
              return target.respond({ ...response, body: JSON.stringify(patch(path, parsed)) });
            } catch { return target.respond(response); }
          };
        }
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return handler(proxy);
  };
}
module.exports = { wrap, COSTS };
