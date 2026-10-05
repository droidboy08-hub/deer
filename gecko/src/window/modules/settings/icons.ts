// Line icons for Settings, copied from the Settings boards (20x20 grid, 1.5 stroke); ported from
// app/src/renderer/modules/settings/icons.ts. Static, trusted markup: turn one into an element
// with icon(markup) (browser.xhtml sanitizes innerHTML, so nothing here goes through it).
import { svg as parseSvg } from '../../dom';

const svg = (size: number, body: string, attrs = 'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" ${attrs} aria-hidden="true" focusable="false">${body}</svg>`;

const sliders = '<path d="M3.5 6h8.2M15.3 6h1.2M3.5 14h2.2M9.3 14h7.2"/><circle cx="13.5" cy="6" r="1.8"/><circle cx="7.5" cy="14" r="1.8"/>';
const contrast = '<circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/>';
const picture = '<rect x="3" y="4" width="14" height="12" rx="2.2"/><circle cx="7.5" cy="8.3" r="1.3"/><path d="m3.6 14.2 4-3.6 3 2.5 2.4-2 3.4 3"/>';
const tabs = '<circle cx="4.8" cy="10" r="2.3"/><rect x="8.5" y="7.7" width="9" height="4.6" rx="2.3"/>';
const download = '<path d="M10 3.5v9M6.4 9 10 12.6 13.6 9"/><path d="M4 16.5h12"/>';
const shield = '<path d="M10 3 4.5 5v4.5c0 3.4 2.3 6.3 5.5 7.5 3.2-1.2 5.5-4.1 5.5-7.5V5z"/>';
const search = '<circle cx="8.8" cy="8.8" r="5.3"/><path d="m12.8 12.8 3.6 3.6"/>';
const keyboard = '<rect x="2.5" y="5.5" width="15" height="9" rx="2"/><path d="M5.5 8.5h1M9.5 8.5h1M13.5 8.5h1M6.5 11.5h7"/>';
const info = '<circle cx="10" cy="10" r="6.5"/><path d="M10 9.2v4M10 6.7v.1"/>';
const puzzle = '<path d="M8 3.5h2.2a1.6 1.6 0 1 1 3.2 0H15a1 1 0 0 1 1 1V7a1.6 1.6 0 1 0 0 3.2v2.3a1 1 0 0 1-1 1h-2.3a1.6 1.6 0 1 0-3.2 0H7a1 1 0 0 1-1-1v-2.3a1.6 1.6 0 1 1 0-3.2V4.5a1 1 0 0 1 1-1z"/>';

/** Sidebar icons (18 px). */
export const nav = {
  general: svg(18, sliders),
  appearance: svg(18, contrast),
  home: svg(18, picture),
  tabs: svg(18, tabs),
  downloads: svg(18, download),
  privacy: svg(18, shield),
  search: svg(18, search),
  shortcuts: svg(18, keyboard),
  about: svg(18, info),
  /** A page another module registers without an icon of its own. */
  generic: svg(18, puzzle),
};

export const ico = {
  settings: svg(16, sliders, 'stroke-width="1.6" stroke-linecap="round"'),
  close: svg(12, '<path d="M6 6l8 8M14 6l-8 8"/>', 'stroke-width="2" stroke-linecap="round"'),
  search: svg(14, search, 'stroke-width="1.7" stroke-linecap="round"'),
  chevronDown: svg(12, '<path d="m5 8 5 5 5-5"/>', 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'),
  chevronRight: svg(12, '<path d="m8 5 5 5-5 5"/>', 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'),
  check: svg(11, '<path d="m5 10.5 3.2 3L15 6.5"/>', 'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"'),
  checkSmall: svg(12, '<path d="m5 10.5 3.2 3L15 6.5"/>', 'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'),
  plus: svg(14, '<path d="M10 4.5v11M4.5 10h11"/>', 'stroke-width="1.8" stroke-linecap="round"'),
  pictureButton: svg(18, picture),
  // Row icons (20 px).
  mode: svg(20, contrast),
  tabBar: svg(20, tabs),
  inset: svg(20, '<rect x="3" y="3.5" width="14" height="13" rx="2.2"/><path d="M3.5 7.5h13" stroke-opacity="0.55"/><path d="M6.5 10.5h7M6.5 13h4.5"/>'),
  picture: svg(20, picture),
  clock: svg(20, '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.4 1.5"/>'),
  searchRow: svg(20, search),
  closeCircle: svg(20, '<circle cx="10" cy="10" r="6.5"/><path d="M7.6 7.6l4.8 4.8M12.4 7.6l-4.8 4.8"/>', 'stroke-width="1.6" stroke-linecap="round"'),
  plusRow: svg(20, '<path d="M10 4.5v11M4.5 10h11"/>', 'stroke-width="1.6" stroke-linecap="round"'),
  selection: svg(20, '<rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke-opacity="0.45"/><rect x="5.5" y="6" width="9" height="8.5" rx="1.5"/>'),
  caret: svg(20, '<rect x="3" y="3.5" width="14" height="13" rx="2.2" stroke-opacity="0.45"/><path d="M8.6 6.5h2.8M8.6 13.5h2.8M10 6.5v7"/>'),
  peek: svg(20,'<path d="M4.5 3.5h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" stroke-opacity="0.45"/><path d="M7 6h6a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V7.5A1.5 1.5 0 0 1 7 6z"/>'),
  folder: svg(20, '<path d="M2.8 6.2A1.7 1.7 0 0 1 4.5 4.5h3.2l1.8 2h6a1.7 1.7 0 0 1 1.7 1.7v6.1a1.7 1.7 0 0 1-1.7 1.7h-11a1.7 1.7 0 0 1-1.7-1.7z"/>'),
  ask: svg(20, '<rect x="3" y="3.5" width="14" height="13" rx="2.2"/><path d="M8 8.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.6M10 13.6v.1"/>'),
  connections: svg(20, '<path d="M3.5 6.5h13M3.5 10h13M3.5 13.5h13" stroke-dasharray="3 1.6"/>'),
  speed: svg(20, '<path d="M4 14.5a6.5 6.5 0 1 1 12 0"/><path d="m10 12 3-4"/>'),
  history: svg(20, '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.4 1.5"/>'),
  range: svg(20, '<rect x="3.5" y="4.5" width="13" height="12" rx="2"/><path d="M3.5 8h13M7 3v3M13 3v3"/>'),
  vitre: svg(20, '<rect x="2.8" y="4.3" width="14.4" height="11.4" rx="3"/><path d="M6 7.6h8" stroke-opacity="0.55"/>'),
  engine: svg(20, '<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c1.8 2 2.6 4.1 2.6 6.5S11.8 14.5 10 16.5c-1.8-2-2.6-4.1-2.6-6.5S8.2 5.5 10 3.5z"/>'),
  update: svg(20, '<path d="M15.6 8.4A5.8 5.8 0 0 0 5 6.2M4.4 11.6A5.8 5.8 0 0 0 15 13.8"/><path d="M15.8 3.8v4.6h-4.6M4.2 16.2v-4.6h4.6"/>'),
  data: svg(20,'<ellipse cx="10" cy="5.5" rx="5.5" ry="2"/><path d="M4.5 5.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M4.5 10c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/>'),
  open: svg(20, '<path d="M8.5 4.5h-3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3"/><path d="M11.5 3.5h5v5M16.5 3.5l-7 7"/>'),
};

/** A fresh <svg> element from one of the markups above. */
export function icon(markup: string): SVGSVGElement {
  return parseSvg(markup);
}
