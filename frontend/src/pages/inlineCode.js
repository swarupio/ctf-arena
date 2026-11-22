// Tiny inline-code parser for challenge descriptions: only `backtick` spans are recognised, everything else is text.
// Returns plain data, so the page renders it as React elements and never needs dangerouslySetInnerHTML.
// An unmatched backtick and an empty pair stay literal text.
export function parseInlineCode(text) {
  const source = typeof text === 'string' ? text : '';
  const parts = [];
  let rest = source;
  let plain = '';
  while (rest.length > 0) {
    const open = rest.indexOf('`');
    if (open === -1) { plain += rest; break; }
    const close = rest.indexOf('`', open + 1);
    if (close === -1) { plain += rest; break; }
    if (close === open + 1) { plain += rest.slice(0, close + 1); rest = rest.slice(close + 1); continue; }
    plain += rest.slice(0, open);
    if (plain) { parts.push({ type: 'text', value: plain }); plain = ''; }
    parts.push({ type: 'code', value: rest.slice(open + 1, close) });
    rest = rest.slice(close + 1);
  }
  if (plain) { parts.push({ type: 'text', value: plain }); }
  return parts;
}
