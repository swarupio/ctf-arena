import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ansiClass, tokenizeOutput } from './ansi.js';
import { copyText } from './clipboard.js';

// A flag-looking string as a lime pill with a tiny copy button. The text node is selectable in one double-click and
// the button label is excluded from selections.
function FlagPill({ flag, onCopied }) {
  const [state, setState] = useState('');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy(event) {
    event.stopPropagation();
    const ok = await copyText(flag);
    setState(ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(''), 1800);
    if (onCopied) onCopied();
  }
  return <span className="tm-flag">
    <span className="tm-flag-text">{flag}</span>
    <button type="button" className="tm-copy" onClick={copy} aria-label="Copy this code to the clipboard">
      {state === 'copied' ? 'copied' : state === 'failed' ? 'select + Ctrl+C' : 'copy'}
    </button>
  </span>;
}

/**
 * Terminal output as React text nodes. ANSI colours become class names, flag-looking strings become pills.
 * Nothing here ever uses dangerouslySetInnerHTML.
 */
function AnsiText({ text, onCopied }) {
  const tokens = useMemo(() => tokenizeOutput(text), [text]);
  return <>{tokens.map((token, index) => {
    if (token.type === 'flag') return <FlagPill key={index} flag={token.flag} onCopied={onCopied} />;
    const className = ansiClass(token);
    return className ? <span key={index} className={className}>{token.text}</span> : token.text;
  })}</>;
}

export default memo(AnsiText);
