import { useState } from 'react';
import { segmentHexRows, segmentText, streamAsText } from '../../forensics/packetStream.js';

// Conversation view. Client and server are told apart by a text label and by alignment, colour is only a hint.
export default function PacketStream({ stream, loading, onClose, onCopy, onSelect, order, onOrder }) {
  const [mode, setMode] = useState('ascii');
  const { endpoints } = stream;
  return <section className="fxp-stream" aria-label="Followed stream">
    <div className="fxp-stream-head">
      <h3>Stream: {stream.packetCount} packets, {stream.payloadBytes} payload bytes</h3>
      <div className="fx-row-buttons">
        <div role="group" aria-label="Show stream as" className="fx-row-buttons">
          <button type="button" className="secondary small" aria-pressed={mode === 'ascii'} onClick={() => setMode('ascii')}>ASCII</button>
          <button type="button" className="secondary small" aria-pressed={mode === 'hex'} onClick={() => setMode('hex')}>Hex</button>
        </div>
        <div role="group" aria-label="Stream order" className="fx-row-buttons">
          <span className="fxp-orderlabel">Order:</span>
          <button type="button" className="secondary small" aria-pressed={order === 'capture'} onClick={() => onOrder('capture')}>capture</button>
          <button type="button" className="secondary small" aria-pressed={order === 'time'} onClick={() => onOrder('time')}>time</button>
        </div>
        <button type="button" className="secondary small" onClick={() => onCopy(streamAsText(stream, mode))}>Copy stream</button>
        <button type="button" className="secondary small" onClick={onClose}>Close stream</button>
      </div>
    </div>
    <p className="fx-meta">
      <strong>Client</strong> {endpoints.client} {'<->'} <strong>Server</strong> {endpoints.server}. Client text is aligned left and marked
      {' "CLIENT >"'}, server text is aligned right and marked {'"SERVER <"'}.
    </p>
    <p className="fx-sr" role="status" aria-atomic="true">{`Stream of ${stream.packetCount} packets, order: ${order}`}</p>
    <p className="fx-muted fxp-ordernote">
      {order === 'time' ? 'Showing time stamp order.' : 'Showing capture order (the order the packets were recorded, by packet number).'}
      {' '}Time stamps can disagree with capture order; each segment shows both its packet number and its time.
    </p>
    {loading && <p className="fx-muted">The capture is still loading, so this stream may be incomplete.</p>}
    <div className="fxp-convo" role="group" aria-label="Conversation">
      {stream.segments.map((s) => (s.control
        ? <p key={s.n} className="fxp-ctl">Packet {s.n} ({s.t}s): {s.control}, no data</p>
        : <div key={s.n} className={`fxp-seg is-${s.side}`}>
          <button type="button" className="fxp-seghead" onClick={() => onSelect(s.n)}>
            {s.side === 'client' ? 'CLIENT >' : 'SERVER <'} packet {s.n}, {s.t}s, {s.bytes.length} bytes{s.cut ? ' (cut)' : ''}
          </button>
          <pre>{mode === 'hex' ? segmentHexRows(s.bytes).join('\n') : segmentText(s.bytes)}</pre>
        </div>))}
    </div>
    {stream.truncated && <p className="fxp-trunc" role="status">
      [Truncated] Showing {stream.shownBytes} of {stream.payloadBytes} payload bytes{stream.omittedPackets ? `, ${stream.omittedPackets} more packets not shown` : ''}.
      Select a single packet to read the rest.
    </p>}
    {stream.clipped && <p className="fx-muted">Payloads of 96 bytes or more are stored clipped at 96 bytes per packet.</p>}
  </section>;
}
