// "Only the newest request may write state". Pages reuse one component when the route parameter changes (another lab,
// level, case or mode), so a slow answer for the old parameter must not overwrite the new page. `begin()` returns a
// function that stays true only until the next `begin()` or `cancel()` (call `cancel()` on unmount).
export function createLatest() {
  let current = 0;
  return {
    begin() {
      current += 1;
      const mine = current;
      return () => mine === current;
    },
    cancel() { current += 1; },
  };
}
