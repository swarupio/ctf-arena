// Pagination maths for the admin tables.
export function pageCount(total, limit) {
  const size = Math.max(1, Math.floor(Number(limit)) || 1);
  return Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / size));
}

export function clampPage(page, total, limit) {
  const value = Math.floor(Number(page)) || 1;
  return Math.min(Math.max(1, value), pageCount(total, limit));
}

// "26-50 of 137" (en dash); "0 results" when empty.
export function rangeLabel(page, limit, total) {
  const count = Math.max(0, Number(total) || 0);
  if (count === 0) return '0 results';
  const size = Math.max(1, Number(limit) || 1);
  const first = (clampPage(page, count, size) - 1) * size + 1;
  return `${first}–${Math.min(count, first + size - 1)} of ${count}`;
}

// Page buttons to show: first, last, the current page and `around` neighbours, with 'gap' markers for skipped runs.
export function pageWindow(page, pages, around = 1) {
  const items = [];
  let previous = 0;
  for (let number = 1; number <= pages; number += 1) {
    if (number === 1 || number === pages || Math.abs(number - page) <= around) {
      if (previous && number - previous === 2) items.push(previous + 1);
      else if (previous && number - previous > 2) items.push('gap');
      items.push(number);
      previous = number;
    }
  }
  return items;
}
