// Line icons from the Downloads and video boards (20x20 grid), ported from
// app/src/renderer/modules/downloads/icons.ts. Static, trusted markup: ic.x(...) returns markup,
// node(markup) turns it into an element (src/window/dom.ts svg(); innerHTML is sanitized here).
import { svg } from '../../dom';

const stroke = (size: number, body: string, width = 1.5): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const fill = (size: number, body: string): string => `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;

const ARROW = '<path d="M10 3.5v9M6.4 9 10 12.6 13.6 9"/><path d="M4 16.5h12"/>';

export const ic = {
  download: (size = 16, width = 1.6): string => stroke(size, ARROW, width),
  close: stroke(12, '<path d="M6 6l8 8M14 6l-8 8"/>', 2),
  search: stroke(14, '<circle cx="8.8" cy="8.8" r="5.3"/><path d="m12.8 12.8 3.6 3.6"/>', 1.7),
  all: stroke(18, '<path d="M3.5 7.5 10 4l6.5 3.5L10 11z"/><path d="M3.5 11 10 14.5 16.5 11"/>'),
  downloading: stroke(18, ARROW),
  queued: stroke(18, '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.4 1.5"/>'),
  paused: stroke(18, '<circle cx="10" cy="10" r="6.5"/><path d="M8.3 7.5v5M11.7 7.5v5"/>'),
  completed: stroke(18, '<circle cx="10" cy="10" r="6.5"/><path d="m7.3 10.2 1.9 1.9 3.6-3.8"/>'),
  video: stroke(18, '<rect x="3" y="4.5" width="14" height="11" rx="2.2"/><path d="M8.5 8v4l3.5-2z" fill="currentColor"/>'),
  music: stroke(18, '<path d="M8 14.5V5l8-1.5v9"/><circle cx="6" cy="14.5" r="2"/><circle cx="14" cy="12.5" r="2"/>'),
  documents: stroke(18, '<path d="M5.5 3h6l3.5 3.5V16a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M11.5 3v3.5H15M7.5 10.5h5M7.5 13.5h5"/>'),
  compressed: stroke(18, '<rect x="3.5" y="4" width="13" height="12.5" rx="1.8"/><path d="M10 4v3M10 8.5v1.5M8.8 11.5h2.4v2.5H8.8z"/>'),
  programs: stroke(18, '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 7.5h14"/>'),
  images: stroke(18, '<rect x="3" y="4" width="14" height="12" rx="2.2"/><circle cx="7.5" cy="8.3" r="1.3"/><path d="m3.6 14.2 4-3.6 3 2.5 2.4-2 3.4 3"/>'),
  other: stroke(18, '<path d="M5.5 3h6l3.5 3.5V16a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M11.5 3v3.5H15"/>'),
  plus: stroke(14, '<path d="M10 4.5v11M4.5 10h11"/>', 2),
  chevron: stroke(12, '<path d="m5 8 5 5 5-5"/>', 1.8),
  pause: (size = 14): string => fill(size, '<rect x="5" y="4" width="3.4" height="12" rx="1"/><rect x="11.6" y="4" width="3.4" height="12" rx="1"/>'),
  play: (size = 14): string => fill(size, '<path d="M6.5 4.5v11l9-5.5z"/>'),
  more: fill(16, '<circle cx="5" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="15" cy="10" r="1.3"/>'),
  folder: (size = 16, width = 1.5): string => stroke(size, '<path d="M3 6a1.5 1.5 0 0 1 1.5-1.5h3.3l1.7 1.8h6A1.5 1.5 0 0 1 17 7.8v6.7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/>', width),
  retry: stroke(15, '<path d="M15.3 10a5.3 5.3 0 1 1-1.55-3.75"/><path d="M15.4 4v3.4H12"/>', 1.6),
  done: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#6ccb5f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 10.5 3.2 3L15 6.5"/></svg>',
  saved: '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8" fill="#6ccb5f"/><path d="m6.4 10.3 2.4 2.4 4.8-5" fill="none" stroke="#0e1a10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: stroke(15, '<rect x="4.5" y="9" width="11" height="7.5" rx="1.8"/><path d="M7 9V7a3 3 0 0 1 6 0v2"/>', 1.7),
  check: stroke(16, '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>', 1.8),
  link: stroke(16, '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1"/>'),
  copy: stroke(16, '<rect x="6.5" y="6.5" width="9.5" height="9.5" rx="1.8"/><path d="M13.5 6.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5"/>'),
  remove: stroke(16, '<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6"/>'),
  cancel: stroke(16, '<circle cx="10" cy="10" r="6.5"/><path d="m7.6 7.6 4.8 4.8M12.4 7.6l-4.8 4.8"/>'),
  open: stroke(16, '<path d="M11 3.5h5.5V9M16.5 3.5 9.5 10.5"/><path d="M14 12v3a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V7.5A1.5 1.5 0 0 1 5 6h3"/>'),
};

export const CATEGORY_ICON = {
  video: ic.video,
  music: ic.music,
  documents: ic.documents,
  compressed: ic.compressed,
  programs: ic.programs,
  images: ic.images,
  other: ic.other,
} as const;

/** An element from icon markup. */
export function node(markup: string): SVGSVGElement {
  return svg(markup);
}
