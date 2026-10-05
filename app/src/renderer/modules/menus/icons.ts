// Menu glyphs: the PeekDiscover set from CtxMenu.dc.html, 20-unit paths drawn at 16 px with a
// 1.5 stroke. A second path is drawn at 45% (Peek's outer sheet).

export type IconName =
  | 'newtab' | 'peek' | 'newwindow' | 'link' | 'download' | 'inspect' | 'back' | 'forward' | 'reload'
  | 'find' | 'search' | 'print' | 'copy' | 'cut' | 'paste' | 'undo' | 'redo' | 'image' | 'pause'
  | 'play' | 'mute' | 'unmute' | 'close' | 'folder' | 'opentab' | 'check';

const PATHS: Record<IconName, [string, string?]> = {
  newtab: ['M5 4.5h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM3 8h6V4.5'],
  peek: ['M7 6h6a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V7.5A1.5 1.5 0 0 1 7 6z', 'M4.5 3.5h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z'],
  newwindow: ['M4.5 5.5h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM6 5.5V4a1.5 1.5 0 0 1 1.5-1.5H16A1.5 1.5 0 0 1 17.5 4v7.5A1.5 1.5 0 0 1 16 13h-1.5'],
  link: ['M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9'],
  download: ['M10 3.5v9M6.4 9 10 12.6 13.6 9M4 16.5h12'],
  inspect: ['M7 6 3 10l4 4M13 6l4 4-4 4'],
  back: ['M12 4.8 6.8 10l5.2 5.2'],
  forward: ['M8 4.8 13.2 10 8 15.2'],
  reload: ['M15.3 10a5.3 5.3 0 1 1-1.55-3.75M15.4 4v3.4H12'],
  find: ['M10.5 16.5H5.5A1.5 1.5 0 0 1 4 15V5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 16 5v4M15.5 13a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0zM14.8 14.8l2.2 2.2'],
  search: ['M14.1 8.8a5.3 5.3 0 1 1-10.6 0 5.3 5.3 0 1 1 10.6 0zM12.8 12.8l3.6 3.6'],
  print: ['M6 7.5V3.5h8v4M6 14H4.5A1.5 1.5 0 0 1 3 12.5V9a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 17 9v3.5a1.5 1.5 0 0 1-1.5 1.5H14M6 11.5h8v5H6z'],
  copy: ['M8 7h7a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 15 17H8a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 8 7zM3.5 12.5V5A1.5 1.5 0 0 1 5 3.5h7.5'],
  cut: ['M8 14.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM16 14.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM7.3 13 13.5 3.5M12.7 13 6.5 3.5'],
  paste: ['M7 4.5H5.5A1.5 1.5 0 0 0 4 6v10a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 16V6a1.5 1.5 0 0 0-1.5-1.5H13M7.5 3h5v3h-5z'],
  undo: ['M7.5 5.5 4 9l3.5 3.5M4 9h7.5a4 4 0 0 1 0 8H9'],
  redo: ['M12.5 5.5 16 9l-3.5 3.5M16 9H8.5a4 4 0 0 0 0 8H11'],
  image: ['M5 4h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 15 16H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 4zM3.5 13.5l4-4 3.5 3.5 2-2 3.5 3.5M13.8 7.8a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 1 1 2.6 0z'],
  pause: ['M7.5 5v10M12.5 5v10'],
  play: ['M7 4.8v10.4l8.2-5.2z'],
  mute: ['M3.5 8v4h3l4 3.5v-11l-4 3.5zM13.5 8l4 4M17.5 8l-4 4'],
  unmute: ['M3.5 8v4h3l4 3.5v-11l-4 3.5zM13.5 7.6a3.4 3.4 0 0 1 0 4.8M15.6 5.5a6.4 6.4 0 0 1 0 9'],
  close: ['M5.5 5.5l9 9M14.5 5.5l-9 9'],
  folder: ['M3 6a1.5 1.5 0 0 1 1.5-1.5H8l1.5 1.5h6A1.5 1.5 0 0 1 17 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z'],
  opentab: ['M8 4.5H5.5A1.5 1.5 0 0 0 4 6v8.5A1.5 1.5 0 0 0 5.5 16H14a1.5 1.5 0 0 0 1.5-1.5V12M11 4.5h4.5V9M15.5 4.5 9.5 10.5'],
  check: ['M5 10.5 8.5 14 15 6.5'],
};

/** The 16 px icon column. Always present, empty when the item has no established glyph. */
export function iconSvg(name: IconName | undefined): string {
  const [d, d2] = name ? PATHS[name] : ['', undefined];
  const second = d2 ? `<path d="${d2}" stroke-opacity="0.45"/>` : '';
  const first = d ? `<path d="${d}"/>` : '';
  return `<svg class="vt-mi-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${first}${second}</svg>`;
}
