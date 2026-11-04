// Big ASCII banners built from a tiny 5x5 font (ASCII only, so it renders the same in every font).
// Each word is at most 5 letters wide = 33 columns with a 2-column gap, which fits a 360px phone screen.

const GLYPHS = {
  F: ['#####', '#    ', '#### ', '#    ', '#    '],
  I: ['#####', '  #  ', '  #  ', '  #  ', '#####'],
  R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
  S: [' ####', '#    ', ' ### ', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  B: ['#### ', '#   #', '#### ', '#   #', '#### '],
  L: ['#    ', '#    ', '#    ', '#    ', '#####'],
  O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
  D: ['#### ', '#   #', '#   #', '#   #', '#### '],
};

/** Rows of one word. Unknown letters become blanks. */
export function bannerWord(word) {
  const letters = String(word).toUpperCase().split('');
  return Array.from({ length: 5 }, (_, row) => letters
    .map((letter) => (GLYPHS[letter] ?? ['     ', '     ', '     ', '     ', '     '])[row])
    .join('  ')
    .replace(/\s+$/, ''));
}

/** Printable lines for several words, one block per word separated by a blank line. */
export function bannerLines(...words) {
  return words.flatMap((word, index) => (index === 0 ? bannerWord(word) : ['', ...bannerWord(word)]));
}

export const FIRST_BLOOD_BANNER = bannerLines('FIRST', 'BLOOD');
