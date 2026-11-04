// Registry of terminal game modes. Each mode file default-exports a definition (docs/TERMINAL_GAME.md section 3).
import easy from './easy.js';
import medium from './medium.js';
import hard from './hard.js';

export const MODE_NAMES = ['easy', 'medium', 'hard'];
export const MODES = { easy, medium, hard };
export const getMode = (name) => (Object.hasOwn(MODES, name) ? MODES[name] : null);
