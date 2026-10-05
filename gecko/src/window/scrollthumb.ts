// The panels' overlay scroll thumb (boards Settings, SettingsKeys, Downloads): Gecko's own
// scrollbars cannot be drawn as Windows 11's overlay thumb (no ::-webkit-scrollbar; even
// scrollbar-width: thin takes 8 px of layout at the panel's rim), so a scroller hides its scrollbar
// and gets a 2 px thumb drawn over its right edge instead.
//
// API for feature modules:
//   scrollThumb(scroller, opts?) -> detach
//     scroller   an element with overflow-y: auto. Its native scrollbar is hidden (class
//                vt-thumbed: scrollbar-width: none) and an aria-hidden <div class="vt-thumb"> is
//                placed beside it in its parent (made position: relative when it is static), over
//                the scroller's right edge: right 3 px, top and bottom 6 px, 2 px wide, radius 1.
//                It follows scrolling, resizes and content changes; it shows only while the
//                content overflows, and is brighter while the pointer is over the scroller or it
//                scrolls. Wheel, keys and touch scroll as before; the thumb itself takes no input.
//     opts       { right?, inset? } px from the scroller's right edge and from its top and bottom.
//   Colour: the CSS variable --vt-thumb on the thumb or any ancestor (default white 0.4; light
//   surfaces set black 0.4), --vt-thumb-active while active (default the same colour).
const STYLE_ID = 'vitre-scrollthumb';
const CSS = `
#vitre-root .vt-thumbed { scrollbar-width: none; }
#vitre-root .vt-thumb {
  position: absolute; width: 2px; border-radius: 1px; pointer-events: none; z-index: 1;
  background: var(--vt-thumb, rgba(255,255,255,0.4)); opacity: 0.7; transition: opacity 200ms ease;
}
#vitre-root .vt-thumb.active { opacity: 1; background: var(--vt-thumb-active, var(--vt-thumb, rgba(255,255,255,0.4))); }
#vitre-root .vt-thumb[hidden] { display: none; }
`;

const MIN_THUMB = 24;

export function scrollThumb(scroller: HTMLElement, opts: { right?: number; inset?: number } = {}): () => void {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head ?? document.documentElement).append(st);
  }
  const right = opts.right ?? 3;
  const inset = opts.inset ?? 6;
  const thumb = document.createElement('div');
  thumb.className = 'vt-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  thumb.hidden = true;
  scroller.classList.add('vt-thumbed');
  let raf = 0;
  let idle = 0;
  let hover = false;

  const place = (): void => {
    raf = 0;
    const parent = scroller.parentElement;
    if (!parent || !scroller.isConnected) return;
    if (thumb.parentElement !== parent) {
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      scroller.after(thumb);
    }
    const view = scroller.clientHeight;
    const full = scroller.scrollHeight;
    const track = view - 2 * inset;
    if (full <= view + 1 || track <= MIN_THUMB) {
      thumb.hidden = true;
      return;
    }
    const h = Math.max(MIN_THUMB, Math.round((track * view) / full));
    const k = scroller.scrollTop / Math.max(1, full - view);
    thumb.hidden = false;
    thumb.style.left = `${scroller.offsetLeft + scroller.offsetWidth - right - 2}px`;
    thumb.style.top = `${scroller.offsetTop + inset + Math.round((track - h) * Math.min(1, Math.max(0, k)))}px`;
    thumb.style.height = `${h}px`;
  };
  const soon = (): void => {
    if (!raf) raf = requestAnimationFrame(place);
  };
  const active = (): void => {
    thumb.classList.add('active');
    window.clearTimeout(idle);
    idle = window.setTimeout(() => {
      if (!hover) thumb.classList.remove('active');
    }, 900);
  };
  const onScroll = (): void => {
    soon();
    active();
  };
  const onEnter = (): void => {
    hover = true;
    thumb.classList.add('active');
  };
  const onLeave = (): void => {
    hover = false;
    active();
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  scroller.addEventListener('mouseenter', onEnter);
  scroller.addEventListener('mouseleave', onLeave);
  const sizes = new ResizeObserver(soon);
  sizes.observe(scroller);
  const content = new MutationObserver(soon);
  content.observe(scroller, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
  window.addEventListener('resize', soon);
  soon();
  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.clearTimeout(idle);
    scroller.removeEventListener('scroll', onScroll);
    scroller.removeEventListener('mouseenter', onEnter);
    scroller.removeEventListener('mouseleave', onLeave);
    window.removeEventListener('resize', soon);
    sizes.disconnect();
    content.disconnect();
    scroller.classList.remove('vt-thumbed');
    thumb.remove();
  };
}
