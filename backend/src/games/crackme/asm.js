// Server-side assembler for Crackme Arcade levels. Source lines: `label:`, `MNEMONIC`, `MNEMONIC operand`, `; comment`.
// Operands: a decimal number, 'A' (character code), $name (symbol from `symbols`), label (its address) or &label (the
// code cell of that instruction, CODE_BASE + address, used by self-modifying levels).
import { CODE_BASE, OPCODES } from './vm.js';

export function assemble(source, symbols = {}) {
  const lines = (Array.isArray(source) ? source : String(source).split('\n'))
    .map((line) => line.replace(/;.*$/, '').trim()).filter(Boolean);
  const labels = {};
  const parsed = [];
  for (const line of lines) {
    const label = /^([A-Za-z_][A-Za-z0-9_]*):$/.exec(line);
    if (label) {
      if (Object.hasOwn(labels, label[1])) { throw new Error(`duplicate label ${label[1]}`); }
      labels[label[1]] = parsed.length;
    } else {
      const [mnemonic, operand, ...rest] = line.split(/\s+/);
      if (!Object.hasOwn(OPCODES, mnemonic) || rest.length > 0) { throw new Error(`bad line: ${line}`); }
      parsed.push([mnemonic, operand]);
    }
  }
  const resolve = (token) => {
    if (/^\d+$/.test(token)) { return Number(token); }
    const char = /^'(.)'$/.exec(token);
    if (char) { return char[1].charCodeAt(0); }
    if (token.startsWith('$')) {
      if (!Object.hasOwn(symbols, token.slice(1))) { throw new Error(`unknown symbol ${token}`); }
      return symbols[token.slice(1)] >>> 0;
    }
    if (token.startsWith('&') && Object.hasOwn(labels, token.slice(1))) { return CODE_BASE + labels[token.slice(1)]; }
    if (Object.hasOwn(labels, token)) { return labels[token]; }
    throw new Error(`unknown operand ${token}`);
  };
  const program = parsed.map(([mnemonic, operand]) => {
    const takes = OPCODES[mnemonic].operand;
    if (takes !== (operand !== undefined)) { throw new Error(`operand mismatch on ${mnemonic}`); }
    return takes ? [mnemonic, resolve(operand)] : [mnemonic];
  });
  return { program, labels };
}
