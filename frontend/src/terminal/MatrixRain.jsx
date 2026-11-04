import { useEffect, useRef } from 'react';

// Digital rain on a canvas that covers the terminal body for about four seconds, then fades out.
// Purely decorative (aria-hidden). The parent never mounts it when the visitor prefers reduced motion.
const GLYPHS = '01ABCDEF<>{}[]$#/\\|=+*';
const SIZE = 15;
const FRAME_MS = 48;
const FADE_MS = 600;

export default function MatrixRain({ duration = 4000, onDone }) {
  const canvasRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas && canvas.getContext('2d');
    if (!canvas || !context) {
      if (doneRef.current) doneRef.current();
      return undefined;
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    context.scale(ratio, ratio);
    context.font = `${SIZE}px ${getComputedStyle(canvas).fontFamily}`;

    const columns = Math.ceil(width / SIZE);
    const drops = Array.from({ length: columns }, () => -Math.floor(Math.random() * (height / SIZE)));
    let frame = 0;
    let fade = 0;
    let last = 0;
    const started = performance.now();

    const draw = (now) => {
      if (now - started >= duration) {
        canvas.style.opacity = '0';
        fade = setTimeout(() => { if (doneRef.current) doneRef.current(); }, FADE_MS);
        return;
      }
      frame = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      last = now;
      context.fillStyle = 'rgba(10, 10, 10, 0.14)';
      context.fillRect(0, 0, width, height);
      for (let i = 0; i < columns; i += 1) {
        const y = drops[i] * SIZE;
        if (y >= 0) {
          context.fillStyle = Math.random() > 0.9 ? '#f2ffd6' : '#b5f23d';
          context.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], i * SIZE, y);
        }
        if (y > height && Math.random() > 0.96) drops[i] = 0;
        drops[i] += 1;
      }
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); clearTimeout(fade); };
  }, [duration]);

  return <canvas ref={canvasRef} className="tm-matrix" aria-hidden="true" />;
}
