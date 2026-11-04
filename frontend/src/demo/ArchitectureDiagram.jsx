import './ArchitectureDiagram.css';

/*
 * Pure, stateless architecture diagram for the "Demo playoff" page.
 * Everything is driven by props; the page shell owns all timers.
 *
 * viewBox 0 0 760 420. Nodes are W x H boxes placed by their top-left corner.
 */

const W = 104;
const H = 64;
const CELL = 2; // size of one icon pixel
const CHAR_W = 6.7; // approx. glyph width of an 11px monospace font
const BUS_Y = 22; // y of the browser -> cognito bus along the top
const BUS_R = 12; // corner radius of that bus

const NODES = {
  browser: {
    x: 10,
    y: 200,
    name: 'Browser',
    label: 'Browser',
    sub: 'React app',
    caption: ['holds the JWT'],
    icon: 'browser',
  },
  cognito: {
    x: 636,
    y: 48,
    name: 'AWS Cognito',
    label: 'Cognito',
    sub: 'AWS · MFA',
    caption: ['only AWS service', 'login + MFA'],
    icon: 'cognito',
  },
  nginx: {
    x: 220,
    y: 200,
    name: 'Nginx load balancer',
    label: 'Nginx',
    sub: 'LB · :80',
    caption: ['round-robin', 'adds X-Served-By'],
    icon: 'nginx',
  },
  backend1: {
    x: 420,
    y: 100,
    name: 'Backend 1',
    label: 'Backend 1',
    sub: 'Express',
    caption: ['stateless x3'],
    icon: 'backend',
  },
  backend2: {
    x: 420,
    y: 200,
    name: 'Backend 2',
    label: 'Backend 2',
    sub: 'Express',
    caption: ['stateless x3'],
    icon: 'backend',
  },
  backend3: {
    x: 420,
    y: 300,
    name: 'Backend 3',
    label: 'Backend 3',
    sub: 'Express',
    caption: ['stateless x3'],
    icon: 'backend',
  },
  mongo: {
    x: 636,
    y: 170,
    name: 'MongoDB Atlas',
    label: 'MongoDB',
    sub: 'Atlas cloud',
    caption: ['all shared state'],
    icon: 'mongo',
  },
  docker: {
    x: 636,
    y: 300,
    name: 'Docker engine',
    label: 'Docker',
    sub: ':30000-30100',
    caption: ['one hardened', 'container per team', 'net: ctf-challenges'],
    icon: 'docker',
  },
};

const NODE_IDS = Object.keys(NODES);
const BACKENDS = ['backend1', 'backend2', 'backend3'];

// 10x10 pixel art, '#' = ink. Each cell is CELL x CELL user units.
const ICONS = {
  browser: [
    '##########',
    '#.#.#....#',
    '##########',
    '#........#',
    '#.######.#',
    '#........#',
    '#.####...#',
    '#........#',
    '#........#',
    '##########',
  ],
  cognito: [
    '...####...',
    '..#....#..',
    '..#....#..',
    '..#....#..',
    '.########.',
    '.##....##.',
    '.##.##.##.',
    '.##.##.##.',
    '.##....##.',
    '.########.',
  ],
  nginx: [
    '##......##',
    '###.....##',
    '####....##',
    '##.##...##',
    '##..##..##',
    '##...##.##',
    '##....####',
    '##.....###',
    '##......##',
    '##......##',
  ],
  backend: [
    '##########',
    '#........#',
    '#.#.####.#',
    '##########',
    '#........#',
    '#.#.####.#',
    '##########',
    '#........#',
    '#.#.####.#',
    '##########',
  ],
  mongo: [
    '..######..',
    '.#......#.',
    '.#......#.',
    '..######..',
    '.#......#.',
    '.#......#.',
    '..######..',
    '.#......#.',
    '.#......#.',
    '..######..',
  ],
  docker: [
    '....##....',
    '....##....',
    '.##.##.##.',
    '.##.##.##.',
    '..........',
    '##########',
    '##########',
    '.########.',
    '..######..',
    '..........',
  ],
};

// Merge horizontal runs of '#' into one rect each.
function iconRects(rows) {
  const rects = [];
  rows.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (row[c] === '#') {
        let end = c;
        while (end < row.length && row[end] === '#') end += 1;
        rects.push({ x: c * CELL, y: r * CELL, w: (end - c) * CELL });
        c = end;
      } else {
        c += 1;
      }
    }
  });
  return rects;
}

const ICON_RECTS = Object.fromEntries(
  Object.entries(ICONS).map(([name, rows]) => [name, iconRects(rows)]),
);

// Edge geometry -------------------------------------------------------------

const rightOf = (id) => [NODES[id].x + W, NODES[id].y + H / 2];
const leftOf = (id) => [NODES[id].x, NODES[id].y + H / 2];
const topOf = (id) => [NODES[id].x + W / 2, NODES[id].y];

// Horizontal-tangent cubic: reads left to right and degrades to a line.
function curve(a, b) {
  const dx = (b[0] - a[0]) / 2;
  return `M${a[0]} ${a[1]}C${a[0] + dx} ${a[1]} ${b[0] - dx} ${b[1]} ${b[0]} ${b[1]}`;
}

function makeEdge(from, to, label, start, end) {
  return {
    key: `${from}>${to}`,
    from,
    to,
    label,
    d: curve(start, end),
    // cubic with symmetric controls: t = 0.5 is the midpoint of the endpoints
    mid: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
  };
}

function makeBusEdge() {
  const [sx, sy] = topOf('browser');
  const [ex, ey] = topOf('cognito');
  return {
    key: 'browser>cognito',
    from: 'browser',
    to: 'cognito',
    label: 'sign in + MFA',
    d:
      `M${sx} ${sy}V${BUS_Y + BUS_R}Q${sx} ${BUS_Y} ${sx + BUS_R} ${BUS_Y}` +
      `H${ex - BUS_R}Q${ex} ${BUS_Y} ${ex} ${BUS_Y + BUS_R}V${ey}`,
    mid: [(sx + ex) / 2, BUS_Y],
  };
}

const EDGES = [
  makeEdge('browser', 'nginx', 'HTTPS request', rightOf('browser'), leftOf('nginx')),
  makeBusEdge(),
  ...BACKENDS.map((id) =>
    makeEdge('nginx', id, 'round-robin', rightOf('nginx'), leftOf(id)),
  ),
  ...BACKENDS.map((id) =>
    makeEdge(id, 'mongo', 'atomic update', rightOf(id), leftOf('mongo')),
  ),
  ...BACKENDS.map((id) =>
    makeEdge(id, 'docker', 'docker API', rightOf(id), leftOf('docker')),
  ),
  ...BACKENDS.map((id) =>
    makeEdge(id, 'cognito', 'verify JWT', rightOf(id), leftOf('cognito')),
  ),
];

const EDGE_BY_KEY = new Map(EDGES.map((edge) => [edge.key, edge]));

// Resolve activeEdges (either direction, unknown ids ignored) -> Map(edgeKey -> { edge, reverse }).
function resolveActive(activeEdges) {
  const found = new Map();
  if (!Array.isArray(activeEdges)) return found;
  activeEdges.forEach((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) return;
    const [a, b] = pair;
    const forward = EDGE_BY_KEY.get(`${a}>${b}`);
    const backward = forward ? null : EDGE_BY_KEY.get(`${b}>${a}`);
    const edge = forward || backward;
    if (edge && !found.has(edge.key)) found.set(edge.key, { edge, reverse: !forward });
  });
  return found;
}

// Chips sit on their edge; nudge down when two active chips would overlap.
function placeChips(flows) {
  const placed = [];
  flows.forEach(({ edge }) => {
    const w = Math.round(edge.label.length * CHAR_W + 14);
    let y = edge.mid[1];
    for (let tries = 0; tries < 8; tries += 1) {
      const hit = placed.some(
        (p) => Math.abs(p.x - edge.mid[0]) < (p.w + w) / 2 && Math.abs(p.y - y) < 20,
      );
      if (!hit) break;
      y += 20;
    }
    placed.push({ key: edge.key, label: edge.label, x: edge.mid[0], y: Math.min(y, 409), w });
  });
  return placed;
}

const ARIA_LABEL =
  'Architecture of Mini CTF Arena. The browser signs in with AWS Cognito, the only AWS service, ' +
  'and sends requests over HTTPS to Nginx. Nginx load balances round-robin across three stateless ' +
  'Express backend replicas. The backends verify Cognito tokens, keep all shared state in MongoDB ' +
  'Atlas, and start one hardened Docker container per team on the ctf-challenges network, ports ' +
  '30000 to 30100.';

function Node({ id, active, served }) {
  const node = NODES[id];
  const cls = [
    'demo-arch__node',
    active ? 'is-active' : '',
    served ? 'is-served' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <g className={cls} transform={`translate(${node.x} ${node.y})`}>
      <rect className="demo-arch__shadow" x="4" y="4" width={W} height={H} />
      <rect className="demo-arch__box" width={W} height={H} />
      <g className="demo-arch__icon" transform="translate(8 8)" shapeRendering="crispEdges">
        {ICON_RECTS[node.icon].map((r) => (
          <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={CELL} />
        ))}
      </g>
      <text className="demo-arch__label" x="8" y="45">
        {node.label}
      </text>
      <text className="demo-arch__sub" x="8" y="58">
        {node.sub}
      </text>
      {node.caption.map((line, i) => (
        <text
          key={line}
          className="demo-arch__caption"
          x={W / 2}
          y={H + 14 + i * 13}
          textAnchor="middle"
        >
          {line}
        </text>
      ))}
      {served ? (
        <g className="demo-arch__badge">
          <rect x={W - 76} y="-9" width="70" height="17" />
          <text x={W - 41} y="3.5" textAnchor="middle">
            ANSWERING
          </text>
        </g>
      ) : null}
    </g>
  );
}

export default function ArchitectureDiagram({
  activeEdges = [],
  servedBy = null,
  running = false,
}) {
  const active = resolveActive(activeEdges);
  const flows = [...active.values()];
  const chips = placeChips(flows);
  const activeNodes = new Set();
  flows.forEach(({ edge }) => {
    activeNodes.add(edge.from);
    activeNodes.add(edge.to);
  });
  const served = BACKENDS.includes(servedBy) ? servedBy : null;

  const flowText = flows.length
    ? flows
        .map(({ edge, reverse }) => {
          const from = NODES[reverse ? edge.to : edge.from].name;
          const to = NODES[reverse ? edge.from : edge.to].name;
          return `${from} to ${to} (${edge.label})`;
        })
        .join('; ')
    : 'no request in flight';
  const summary =
    `Current flow${running ? '' : ' (paused)'}: ${flowText}.` +
    (served ? ` Answered by ${NODES[served].name}.` : '');

  return (
    <div className={`demo-arch${running ? '' : ' is-paused'}`}>
      <div className="demo-arch__scroll">
        <svg
          className="demo-arch__svg"
          viewBox="-6 0 812 420"
          role="img"
          aria-label={ARIA_LABEL}
          focusable="false"
        >
          <g className="demo-arch__links" aria-hidden="true">
            {EDGES.map((edge) => (
              <path key={edge.key} className="demo-arch__link" d={edge.d} />
            ))}
          </g>

          <g className="demo-arch__flows" aria-hidden="true">
            {flows.map(({ edge, reverse }) => (
              <g key={edge.key} className={`demo-arch__flow${reverse ? ' is-reverse' : ''}`}>
                <path className="demo-arch__flow-line" d={edge.d} />
                <path className="demo-arch__flow-dash" d={edge.d} />
              </g>
            ))}
          </g>

          <g className="demo-arch__nodes" aria-hidden="true">
            {NODE_IDS.map((id) => (
              <Node key={id} id={id} active={activeNodes.has(id)} served={served === id} />
            ))}
          </g>

          <g className="demo-arch__chips" aria-hidden="true">
            {chips.map((chip) => (
              <g key={chip.key} transform={`translate(${chip.x} ${chip.y})`}>
                <rect x={-chip.w / 2} y="-9" width={chip.w} height="18" />
                <text y="4" textAnchor="middle">
                  {chip.label}
                </text>
              </g>
            ))}
          </g>

          <g className="demo-arch__legend" aria-hidden="true">
            <path className="demo-arch__link" d="M10 350H42" />
            <text x="52" y="354">
              idle link
            </text>
            <path className="demo-arch__flow-line" d="M10 372H42" />
            <path className="demo-arch__legend-dash" d="M10 372H42" />
            <text x="52" y="376">
              request in flight
            </text>
          </g>
        </svg>
      </div>
      <p className="demo-arch__sr">{summary}</p>
    </div>
  );
}
