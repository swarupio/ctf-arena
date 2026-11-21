// Lab: a reflected-XSS "sanitiser" judged purely by string rules. The output is never rendered as HTML:
// the server scans the sanitised text with a linear hand-written scanner and reports what a browser WOULD do.
import { notFound, page, strField } from '../http.js';
import { LIMITS } from '../limits.js';

// The deliberately weak sanitiser: lower-case "<script>" tags, "javascript:" and the "onerror" attribute are removed
// in one pass (case-sensitive, not re-scanned).
export function weakSanitise(input) {
  return input.replaceAll('<script>', '').replaceAll('</script>', '').replaceAll('javascript:', '').replaceAll('onerror', '');
}

const isNameChar = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-' || c === ':';
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction']);

// Returns the "execution vectors" a browser would run found in html. Linear in the input; hard-capped.
export function scanVectors(html) {
  const text = html.slice(0, LIMITS.HTML_SCAN);
  const vectors = [];
  let i = 0;
  while (i < text.length && vectors.length < 5) {
    if (text[i] !== '<') { i += 1; continue; }
    let j = i + 1;
    while (j < text.length && isNameChar(text[j]) && j - i < 30) { j += 1; }
    const tag = text.slice(i + 1, j).toLowerCase();
    if (tag.length === 0) { i += 1; continue; }
    const close = text.indexOf('>', j);
    const end = close === -1 ? text.length : close;
    if (tag === 'script') {
      const inner = text.slice(end + 1, text.indexOf('<', end + 1) === -1 ? text.length : text.indexOf('<', end + 1));
      if (inner.trim().length > 0) { vectors.push('script element'); }
    }
    // Attributes: name[=value] separated by whitespace or '/'.
    let k = j;
    while (k < end) {
      while (k < end && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n' || text[k] === '/')) { k += 1; }
      let nameEnd = k;
      while (nameEnd < end && text[nameEnd] !== '=' && text[nameEnd] !== ' ' && text[nameEnd] !== '\t' && text[nameEnd] !== '\n' && text[nameEnd] !== '/') { nameEnd += 1; }
      const name = text.slice(k, nameEnd).toLowerCase();
      let value = '';
      let next = nameEnd;
      if (text[nameEnd] === '=') {
        const quote = text[nameEnd + 1];
        if (quote === '"' || quote === "'") {
          const stop = text.indexOf(quote, nameEnd + 2);
          const valueEnd = stop === -1 ? end : Math.min(stop, end);
          value = text.slice(nameEnd + 2, valueEnd);
          next = valueEnd + 1;
        } else {
          let valueEnd = nameEnd + 1;
          while (valueEnd < end && text[valueEnd] !== ' ' && text[valueEnd] !== '\t') { valueEnd += 1; }
          value = text.slice(nameEnd + 1, valueEnd);
          next = valueEnd;
        }
      }
      if (name.length > 2 && name.startsWith('on') && value.trim().length > 0) { vectors.push(`${name} handler on <${tag}>`); }
      if (URL_ATTRS.has(name)) {
        const squashed = [...value.toLowerCase()].filter((c) => c > ' ').join('');
        if (squashed.startsWith('javascript:') && squashed.length > 11) { vectors.push(`javascript: URL in ${name}`); }
      }
      k = Math.max(next, k + 1);
    }
    i = end + 1;
  }
  return [...new Set(vectors)].slice(0, 5);
}

export default {
  id: 'xss-filter',
  title: 'Review Rumble',
  summary: 'Customer reviews are "sanitised". The filter has opinions about lower-case letters.',
  story: 'Slice of Life Pizza shows customer reviews on the staff screen. The filter was written on a Friday afternoon.',
  objective: 'Craft a review whose sanitised text would still run JavaScript in the browser of the staff member who reads it. Nothing is really rendered: the server judges the text and shows it to you as plain, escaped source.',
  hints: [
    'Look at what the filter removes. Is it case sensitive? Does it re-check after removing?',
    'You do not need a script tag at all: many other tags run code from an event attribute such as onload or onmouseover.',
    'Something like an svg or img tag with an event handler that is not onerror, or a mixed-case ScRiPt tag, gets through.',
  ],
  points: 80,
  severity: 'medium',
  bountyUsd: 600,
  site: { name: 'Slice of Life Reviews', theme: 'pizza', path: 'slice.pizza/reviews' },
  form: { fields: [{ name: 'comment', label: 'Your review', type: 'text', in: 'query', default: 'Great crust!' }], submit: { method: 'GET', path: '/reviews', label: 'Post review', encoding: 'query' } },
  template: () => ({ method: 'GET', path: '/reviews?comment=Great%20crust!', headers: {}, cookies: {}, body: '' }),
  handle(ctx, req) {
    if (req.method !== 'GET' || req.pathname !== '/reviews') { return notFound(); }
    const comment = strField(req.query.comment, LIMITS.FIELD);
    const sanitised = weakSanitise(comment);
    const vectors = scanVectors(`<div class="review">${sanitised}</div>`);
    const blocks = [
      { t: 'heading', text: 'Staff screen: new review' },
      { t: 'text', text: 'What the page source would contain after sanitising (shown as plain text):' },
      { t: 'code', text: `<div class="review">${sanitised}</div>` },
    ];
    if (vectors.length === 0) {
      blocks.push({ t: 'notice', tone: 'info', text: 'Browser verdict: harmless text. Nothing would run.' });
      return page(200, 'Reviews', blocks);
    }
    blocks.push({ t: 'notice', tone: 'success', text: `Browser verdict: code would run (${vectors.join(', ')}).` });
    blocks.push({ t: 'kv', items: [['Stolen staff session', ctx.flag]] });
    return page(200, 'Reviews', blocks, { exploited: true });
  },
};
