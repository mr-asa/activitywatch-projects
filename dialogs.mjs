// Modal dialogs inside the ActivityWatch frame. The frame is as tall as the
// dashboard and the ActivityWatch page scrolls around it, so a dialog is
// placed where the user is looking; the page is never scrolled to reach it.
export function placeDialog(d) {
  const frame = window.frameElement;
  if (!frame) return;
  const rect = frame.getBoundingClientRect(),
    { top: from, bottom: to } = visibleArea(frame);
  d.style.top = from - rect.top + 16 + "px";
  d.style.bottom = "auto";
  d.style.margin = "0 auto";
  d.style.maxHeight = Math.max(240, to - from - 32) + "px";
}
// The part of the parent window where the frame can be seen. ActivityWatch
// may scroll its page inside a container between its header and footer
// (every clipping ancestor narrows the window's height), or scroll the window
// under a fixed header drawn on top of the frame.
function visibleArea(frame) {
  const parent = window.parent;
  let top = 0,
    bottom = parent.innerHeight;
  for (
    let el = frame.parentElement;
    el && el !== parent.document.documentElement;
    el = el.parentElement
  ) {
    if (!/auto|scroll|hidden|clip/.test(parent.getComputedStyle(el).overflowY))
      continue;
    const r = el.getBoundingClientRect();
    top = Math.max(top, r.top + el.clientTop);
    bottom = Math.min(bottom, r.top + el.clientTop + el.clientHeight);
  }
  // Skip what covers the frame at its top and bottom edges (a fixed header
  // or footer): the frame must be the element actually shown there.
  const rect = frame.getBoundingClientRect();
  const x = Math.min(
    parent.innerWidth - 1,
    Math.max(0, rect.left + rect.width / 2),
  );
  const shown = (y) => parent.document.elementFromPoint(x, y) === frame;
  top = Math.max(top, rect.top);
  bottom = Math.min(bottom, rect.bottom);
  for (let n = 0; n < 100 && top < bottom && !shown(top); n++) top += 4;
  for (let n = 0; n < 100 && bottom > top && !shown(bottom - 1); n++)
    bottom -= 4;
  return { top, bottom };
}
export function openModal(d) {
  placeDialog(d);
  d.showModal();
}

// While a dialog is open, the wheel scrolls only inside it: never the page
// behind it or the ActivityWatch page around the frame (which would move the
// dialog out of view once its own content reaches the end).
function canScroll(el, dx, dy) {
  const vertical = Math.abs(dy) >= Math.abs(dx),
    delta = vertical ? dy : dx;
  for (; el && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (!/auto|scroll/.test(vertical ? style.overflowY : style.overflowX))
      continue;
    const [pos, size, view] = vertical
      ? [el.scrollTop, el.scrollHeight, el.clientHeight]
      : [el.scrollLeft, el.scrollWidth, el.clientWidth];
    if (delta < 0 ? pos > 0 : pos + view < size - 1) return true;
  }
  return false;
}
export function lockScrollBehindDialogs() {
  document.addEventListener(
    "wheel",
    (e) => {
      const dialogs = [...document.querySelectorAll("dialog[open]")];
      if (!dialogs.length) return;
      // Over the backdrop the target is the dialog itself, outside its box.
      const inside = dialogs.some((d) => {
        if (!d.contains(e.target)) return false;
        if (e.target !== d) return true;
        const r = d.getBoundingClientRect();
        return (
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
        );
      });
      if (!inside || !canScroll(e.target, e.deltaX, e.deltaY))
        e.preventDefault();
    },
    { passive: false },
  );
}
