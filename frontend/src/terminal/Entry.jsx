import { memo } from 'react';
import { Link } from 'react-router-dom';
import AnsiText from './AnsiText.jsx';

const SYS_TAG = { error: 'error:', warn: 'warning:', info: 'note:' };

/**
 * One scrollback entry. Kinds: cmd (echoed prompt + command), out (server output, ANSI), sys (client message with
 * an optional link), result (submit result block), banner (ASCII art) and matches (Tab completion list).
 * Entries are immutable and memoised, so typing in the input line never re-renders the history.
 */
function Entry({ entry, onCopied }) {
  switch (entry.kind) {
    case 'cmd':
      return <div className="tm-line tm-cmd"><span className="tm-prompt">{entry.prompt}</span> <span className="tm-typed">{entry.text}</span></div>;
    case 'out':
      return <div className="tm-line tm-out"><AnsiText text={entry.text} onCopied={onCopied} /></div>;
    case 'sys':
      return <div className={`tm-line tm-sys tm-sys--${entry.tone}`}>
        <span className="tm-sys-tag">{SYS_TAG[entry.tone] ?? SYS_TAG.info}</span> {entry.text}
        {entry.link && <> <Link className="tm-link" to={entry.link.to}>{entry.link.label}</Link></>}
      </div>;
    case 'result':
      return <div className={`tm-result tm-result--${entry.tone}`} role="group" aria-label="Submit result">
        <div className="tm-result-head"><span className="tm-result-tag">{entry.tag}</span> {entry.headline}</div>
        {entry.lines.map((line, index) => <div key={index} className="tm-result-line">{line}</div>)}
      </div>;
    case 'banner':
      return <pre className="tm-banner" role="img" aria-label={entry.label}>{entry.lines.join('\n')}</pre>;
    case 'matches': {
      const width = Math.max(...entry.items.map((item) => item.length), 1) + 2;
      return <div className="tm-matches" style={{ columnWidth: `${width}ch` }}>
        {entry.items.map((item) => <span key={item} className={item.endsWith('/') ? 'ansi-blue ansi-bold' : undefined}>{item}</span>)}
      </div>;
    }
    default:
      return null;
  }
}

export default memo(Entry);
