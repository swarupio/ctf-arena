// Initials for the account box in the header. Pure, no DOM.
// - a name with two or more words (or a camelCase / dotted address such as ada.lovelace or AdaLovelace) gives two
//   initials: the first word and the last word;
// - one word (a handle, a nickname, anything creative) gives one initial and `solo: true`, which the header draws bigger;
// - names without letters (an emoji, digits) use their first character; an empty value gives 'U'.
const LETTER = /\p{L}/u;

function firstOf(word) {
  return Array.from(word).find((char) => LETTER.test(char)) ?? '';
}

export function nameSource({ displayName, email } = {}) {
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  if (name) return name;
  const address = typeof email === 'string' ? email.trim() : '';
  // the part before the @, without a +tag (ada+work@example.org is ada)
  return address.split('@')[0].split('+')[0];
}

export function nameWords(source) {
  return String(source ?? '')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => LETTER.test(word));
}

export function initialsOf(user) {
  const source = nameSource(user);
  const words = nameWords(source);
  if (words.length >= 2) {
    const text = (firstOf(words[0]) + firstOf(words[words.length - 1])).toLocaleUpperCase();
    return { text, solo: false };
  }
  if (words.length === 1) return { text: firstOf(words[0]).toLocaleUpperCase(), solo: true };
  // no letters at all (an emoji name, digits only): the first visible character, or a neutral U
  const glyph = Array.from(source.trim())[0];
  return { text: glyph ? glyph.toLocaleUpperCase() : 'U', solo: true };
}
