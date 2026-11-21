import { useEffect, useMemo, useRef, useState } from 'react';
import { CHANNELS, base64ToBytes, extractLsb, pixelAt, renderPixels } from '../../forensics/stego.js';
import { useArtefact } from './hooks.js';

const CELL = 12;

// Pixel grid on a canvas. The picture hides a short message in the least significant bits of one colour channel.
export default function PixelGrid({ track, artefact }) {
  const [image, setImage] = useState(1);
  const [view, setView] = useState('color');
  const [channel, setChannel] = useState(0);
  const [lsbFirst, setLsbFirst] = useState(false);
  const [hover, setHover] = useState(null);
  const { data, loading, error } = useArtefact(track, artefact.id, { image });
  const canvas = useRef(null);
  const pixels = useMemo(() => (data ? base64ToBytes(data.pixels) : null), [data]);
  const text = useMemo(() => (pixels ? extractLsb(pixels, { channel, lsbFirst, maxChars: 40 }) : ''), [pixels, channel, lsbFirst]);

  useEffect(() => {
    const node = canvas.current;
    if (!node || !data || !pixels) { return; }
    const context = node.getContext('2d');
    if (!context) { return; }
    const small = document.createElement('canvas');
    small.width = data.width; small.height = data.height;
    small.getContext('2d').putImageData(new ImageData(renderPixels(pixels, { view, channel }), data.width, data.height), 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, node.width, node.height);
    context.drawImage(small, 0, 0, data.width * CELL, data.height * CELL);
  }, [data, pixels, view, channel]);

  const onMove = (event) => {
    if (!data) { return; }
    const box = event.currentTarget.getBoundingClientRect();
    const scale = (data.width * CELL) / box.width;
    const index = pixelAt((event.clientX - box.left) * scale, (event.clientY - box.top) * scale, CELL, data.width);
    if (index >= 0 && index < data.width * data.height) { setHover(index); }
  };
  const info = hover !== null && pixels ? `pixel ${hover} (x ${hover % data.width}, y ${Math.floor(hover / data.width)}): R ${pixels[hover * 3]} G ${pixels[hover * 3 + 1]} B ${pixels[hover * 3 + 2]}` : 'Hover the picture to read a pixel.';

  return <section className="fx-tool" aria-label="Pixel grid">
    <div className="fx-controls">
      {data && data.images > 1 && <label>Image
        <select value={image} onChange={(e) => setImage(Number(e.target.value))}>
          {Array.from({ length: data.images }, (_, k) => <option key={k + 1} value={k + 1}>img-{k + 1}</option>)}
        </select></label>}
      <label>View
        <select value={view} onChange={(e) => setView(e.target.value)}>
          <option value="color">Colour</option><option value="plane">Bit plane (one channel)</option><option value="amplify">All low bits</option>
        </select></label>
      <label>Channel
        <select value={channel} onChange={(e) => setChannel(Number(e.target.value))}>
          {CHANNELS.map((name, k) => <option key={name} value={k}>{name}</option>)}
        </select></label>
      <label>Bit order
        <select value={lsbFirst ? 'lsb' : 'msb'} onChange={(e) => setLsbFirst(e.target.value === 'lsb')}>
          <option value="msb">most significant first</option><option value="lsb">least significant first</option>
        </select></label>
    </div>
    {loading && <p role="status">Loading image...</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {data && <div className="fx-pixels">
      <canvas
        ref={canvas} width={data.width * CELL} height={data.height * CELL} className="fx-canvas" onMouseMove={onMove}
        role="img" aria-label={`Generated ${data.width} by ${data.height} pixel picture. Use the controls to read its hidden bits as text.`}
      />
      <div className="fx-readout">
        <h3>Reading the low bits</h3>
        <p className="fx-muted">{CHANNELS[channel]} channel, {lsbFirst ? 'least' : 'most'} significant bit first, row by row.</p>
        <output className="fx-decoded" aria-live="polite">{text || '(nothing readable)'}</output>
        <p className="fx-meta" aria-live="off">{info}</p>
      </div>
    </div>}
  </section>;
}
