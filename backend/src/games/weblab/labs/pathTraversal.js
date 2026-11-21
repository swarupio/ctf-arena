// Lab: a menu file viewer over a hardcoded virtual tree, with the classic "strip ../ once" filter.
import { notFound, page, safeDecode, strField } from '../http.js';
import { LIMITS } from '../limits.js';
import { VirtualTree, resolvePath, stripDotDotOnce } from '../vfs.js';

const BASE = '/var/www/menu';

function tree(ctx) {
  const keyFile = `/srv/backups/dough-${ctx.key('keyfile').slice(0, 8)}.key`;
  return {
    keyFile,
    vfs: new VirtualTree({
      [`${BASE}/specials.txt`]: 'Today: Margherita 9 coins, Pepperoni 11 coins, Pineapple (controversial) 10 coins.',
      [`${BASE}/drinks.txt`]: 'Cola, lemonade, and a mysterious green soda.',
      [`${BASE}/allergens.txt`]: 'Contains: gluten, dairy, regret.',
      '/etc/hostname': 'slice-of-life-web-01',
      '/etc/passwd': 'root:x:0:0:root:/root:/bin/sh\nwww:x:33:33:pizza web:/var/www:/bin/false\nchef:x:1001:1001:Head Chef:/home/chef:/bin/sh',
      '/srv/app/config.ini': `[kitchen]\nname=Slice of Life\n; nightly backup of the secret dough recipe lives here:\nrecipe_backup=${keyFile}\n`,
      [keyFile]: `RECIPE VAULT KEY: ${ctx.flag}`,
    }),
  };
}

export default {
  id: 'path-traversal',
  title: 'Secret Dough',
  summary: 'The menu viewer opens files by name. Which files, exactly?',
  story: 'Slice of Life Pizza lets customers read the menu as text files. The chef hid the family dough recipe somewhere on the same server.',
  objective: 'Read the recipe vault key stored outside the menu folder.',
  hints: [
    'The viewer prepends /var/www/menu/ to the name you give. Can the name climb out of that folder?',
    'The ../ sequence climbs one folder. The server removes it, but only one pass is made.',
    'Hide the sequence inside itself (....//) or percent-encode it twice. Look at /srv/app/config.ini, it tells you where the backup is.',
  ],
  points: 80,
  severity: 'high',
  bountyUsd: 900,
  site: { name: 'Slice of Life Pizza', theme: 'pizza', path: 'slice.pizza/menu' },
  form: { fields: [{ name: 'file', label: 'Menu file', type: 'text', in: 'query', default: 'specials.txt' }], submit: { method: 'GET', path: '/menu', label: 'Open', encoding: 'query' } },
  template: () => ({ method: 'GET', path: '/menu?file=specials.txt', headers: {}, cookies: {}, body: '' }),
  handle(ctx, req) {
    const { vfs } = tree(ctx);
    if (req.method !== 'GET' || req.pathname !== '/menu') { return notFound(); }
    const raw = strField(req.query.file, LIMITS.FIELD);
    if (!raw) { return page(400, 'Menu', [{ t: 'notice', tone: 'error', text: 'Missing ?file= parameter.' }]); }
    // The bug: the filter runs before the percent-decoding and removes "../" only once.
    const cleaned = safeDecode(stripDotDotOnce(raw));
    const path = resolvePath(BASE, cleaned);
    const node = path === null ? null : vfs.read(path);
    if (!node) { return page(404, 'Menu', [{ t: 'notice', tone: 'error', text: `No such file: ${path ?? '(invalid path)'}` }]); }
    if (node.type === 'dir') { return page(200, 'Menu', [{ t: 'text', text: `${path} is a directory:` }, { t: 'code', text: node.entries.join('\n') }]); }
    const leaked = path !== null && !path.startsWith(`${BASE}/`);
    return page(200, 'Menu', [{ t: 'text', text: `Showing ${path}` }, { t: 'code', text: node.content }],
      leaked && node.content.includes(ctx.flag) ? { exploited: true } : {});
  },
};
