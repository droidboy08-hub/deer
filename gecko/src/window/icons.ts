// Icon markup, ported from app/src/renderer/icons.ts. Static, trusted strings: turn one into an
// element with svg(icons.back) from ./dom (innerHTML is sanitized in browser.xhtml).
// XML allows an attribute only once (DOMParser rejects duplicates), so a stroke width passed in
// `extra` replaces the default instead of being appended next to it.
const svg = (size: number, body: string, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" ${extra.includes('stroke-width') ? '' : 'stroke-width="1.6" '}stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  back: svg(18, '<path d="M12 4.8 6.8 10l5.2 5.2"/>'),
  forward: svg(18, '<path d="M8 4.8 13.2 10 8 15.2"/>'),
  reload: svg(17, '<path d="M15.3 10a5.3 5.3 0 1 1-1.55-3.75"/><path d="M15.4 4v3.4H12"/>'),
  stop: svg(13, '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>', 'stroke-width="1.6"'),
  plus: svg(18, '<path d="M10 4.5v11M4.5 10h11"/>'),
  home: svg(18, '<path d="M3.5 9.5 10 4l6.5 5.5V16a1 1 0 0 1-1 1H12v-4.5H8V17H4.5a1 1 0 0 1-1-1z"/>'),
  search: svg(16, '<circle cx="8.8" cy="8.8" r="5.3"/><path d="m12.8 12.8 3.6 3.6"/>'),
  globe: svg(16, '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.2 2.8 4.6 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.6-2.8-7S8 5.2 10 3z"/>', 'stroke-width="1.3"'),
  closeSmall: svg(10, '<path d="M6 6l8 8M14 6l-8 8"/>', 'stroke-width="2.2"'),
  switchTab: svg(14, '<path d="M16 4.5v6a2 2 0 0 1-2 2H5"/><path d="m8 9.5-3 3 3 3"/>'),
  history: svg(16, '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.4 1.5"/>'),
  minimize: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M4.5 10h11"/></svg>',
  maximize: '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>',
  restore: '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="4" y="6.5" width="9.5" height="9.5" rx="1.8"/><path d="M7 6.5V5.8A1.8 1.8 0 0 1 8.8 4h5.4A1.8 1.8 0 0 1 16 5.8v5.4a1.8 1.8 0 0 1-1.8 1.8h-.7"/></svg>',
  closeWin: '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l11 11M15.5 4.5l-11 11"/></svg>',
};
