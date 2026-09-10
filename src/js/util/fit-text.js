// Shrinks (never grows) an element's font-size until its text fits on one
// line within its current box width, stopping at minFontSizePx if it still
// doesn't fit at that floor. Used wherever a label's length is unpredictable
// (a team name, a player's display name) and should read as large as
// possible without overflowing or wrapping — start the element's CSS
// font-size at the biggest size it should ever be, then call this once the
// element is actually laid out.
export function shrinkFontToFit(label, minFontSizePx) {
  const maxFontSize = parseFloat(getComputedStyle(label).fontSize);
  let fontSize = maxFontSize;
  label.style.fontSize = "";
  while (label.scrollWidth > label.clientWidth && fontSize > minFontSizePx) {
    fontSize -= 0.5;
    label.style.fontSize = `${fontSize}px`;
  }
}
