// The built-in Settings pages. Every control reads and writes the real settings store (VitreSettings,
// vitre.* prefs); rows are declared once so "Find a setting" can list them on any page.
// Ported from app/src/renderer/modules/settings/pages.ts. Gecko changes: the folder and file
// dialogs are nsIFilePicker (gecko.ts), Clear browsing data is Firefox's Sanitizer with a time range,
// About names the Gecko runtime and carries the updater's card (VitreUpdater: version, status line,
// Check for updates / Restart to update, the automatic check), and Appearance carries "Start pages
// below the tab bar" (pageInset).
// Sidebar order: general 10, appearance 20, home 30, tabs 40, downloads 50, privacy 60, search 70,
// shortcuts 80, about 90; a module's page (registerPage) slots in by its own `order`.
import type { UpdateState } from '../../../modules/VitreUpdater.sys';
import { SEARCH_ENGINES, type Settings } from '../../../shared/settings';
import { updateStatus } from '../../../shared/update';
import { backgroundPicker } from './bg-picker';
import { button, checkRow, dropdown, h, liveDesc, localDropdown, localToggle, radioRows, row, segmented, toggle, type Option, type RowDef, type SectionDef } from './controls';
import { engineInfo, fileURL, forgetClosedEverywhere, openFolder, pickFolder, sanitize, type SanitizeItem } from './gecko';
import { ico, icon, nav } from './icons';
import { fillKeys } from './keymap';
import { shortcutsSection } from './shortcuts-page';

// ---- rows shared by a page and General ----

const modeRow = (unlisted = false): RowDef => ({
  title: 'Mode',
  desc: 'System follows your Windows setting',
  keywords: 'theme dark light appearance colour color',
  unlisted,
  build: (ctx) =>
    row({
      icon: ico.mode,
      title: 'Mode',
      desc: 'System follows your Windows setting',
      control: (ids) =>
        segmented(ctx, {
          labelledBy: ids.title,
          options: [
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ],
          get: (s) => s.theme,
          set: (v) => ctx.set({ theme: v }),
        }),
    }),
});

const ENGINES = (Object.keys(SEARCH_ENGINES) as Settings['searchEngine'][]).map((id) => ({
  value: id,
  label: SEARCH_ENGINES[id].name,
  desc: new URL(SEARCH_ENGINES[id].url).hostname.replace(/^www\./, ''),
}));

const engineDropdownRow: RowDef = {
  title: 'Search engine',
  desc: 'Used in the address field and for selected text',
  unlisted: true,
  build: (ctx) =>
    row({
      icon: ico.searchRow,
      title: 'Search engine',
      desc: 'Used in the address field and for selected text',
      control: (ids) => dropdown(ctx, { labelledBy: ids.title, options: ENGINES, get: (s) => s.searchEngine, set: (v) => ctx.set({ searchEngine: v }) }),
    }),
};

const newTabRow = (unlisted = false): RowDef => ({
  title: 'New tabs open',
  desc: 'Where a tab from a link or the + button appears',
  keywords: 'position next end',
  unlisted,
  build: (ctx) =>
    row({
      icon: ico.plusRow,
      title: 'New tabs open',
      desc: 'Where a tab from a link or the + button appears',
      control: (ids) =>
        dropdown(ctx, {
          labelledBy: ids.title,
          options: [
            { value: 'next', label: 'Next to the current tab' },
            { value: 'end', label: 'At the end' },
          ],
          get: (s) => s.newTabPosition,
          set: (v) => ctx.set({ newTabPosition: v }),
        }),
    }),
});

const folderRow = (unlisted = false): RowDef => ({
  title: 'Save files to',
  keywords: 'downloads folder location directory',
  unlisted,
  build: (ctx) => {
    const el = row({
      icon: ico.folder,
      title: 'Save files to',
      desc: ' ',
      control: (ids) =>
        button(
          'Change',
          async () => {
            const dir = await pickFolder('Save downloads to', ctx.s().downloadsFolder);
            if (dir) ctx.set({ downloadsFolder: dir });
          },
          { describedBy: ids.desc, label: 'Change download folder' },
        ),
    });
    el.querySelector('.vs-desc')?.classList.add('vs-path');
    liveDesc(ctx, el, (s) => s.downloadsFolder || 'Downloads');
    return el;
  },
});

const askRow = (unlisted = false): RowDef => ({
  title: 'Ask where to save each file',
  desc: 'Choose a folder and a name every time',
  keywords: 'downloads prompt dialog save as',
  unlisted,
  build: (ctx) =>
    row({
      icon: ico.ask,
      title: 'Ask where to save each file',
      desc: 'Choose a folder and a name every time',
      control: (ids) => toggle(ctx, { labelledBy: ids.title, describedBy: ids.desc, get: (s) => s.askWhereToSave, set: (v) => ctx.set({ askWhereToSave: v }) }),
    }),
});

/** A drop-down row over one setting, for the plain cases. */
function choiceRow<K extends keyof Settings>(o: { icon: string; title: string; desc: string; keywords?: string; key: K; options: Option<Extract<Settings[K], string>>[] }): RowDef {
  return {
    title: o.title,
    desc: o.desc,
    keywords: o.keywords,
    build: (ctx) =>
      row({
        icon: o.icon,
        title: o.title,
        desc: o.desc,
        control: (ids) =>
          dropdown(ctx, {
            labelledBy: ids.title,
            options: o.options,
            get: (s) => s[o.key] as Extract<Settings[K], string>,
            set: (v) => ctx.set({ [o.key]: v } as Partial<Settings>),
          }),
      }),
  };
}

// ---- General ----

const general: SectionDef = {
  id: 'general',
  title: 'General',
  icon: nav.general,
  order: 10,
  groups: () => [
    { title: 'Theme', rows: [modeRow(true)] },
    { title: 'Search', rows: [engineDropdownRow] },
    { title: 'Tabs', rows: [newTabRow(true)] },
    { title: 'Downloads', rows: [folderRow(true), askRow(true)] },
  ],
};

// ---- Appearance ----

/** The two app icons (VitreAppIcon); previews are built by tools/make-icon.py. */
const APP_ICONS: { value: Settings['appIcon']; label: string }[] = [
  { value: 'gold', label: 'Gold' },
  { value: 'orange', label: 'Orange' },
];

const appIconRow: RowDef = {
  title: 'App icon',
  desc: 'Gold or Orange, on the taskbar and Deer’s shortcuts',
  keywords: 'icon logo taskbar shortcut start menu desktop alt+tab deer gold orange',
  build: (ctx) => {
    const tiles = APP_ICONS.map((ic) => {
      const preview = h('span', { class: 'vs-style-preview' }, h('img', { src: `chrome://vitre/content/skin/app-icons/${ic.value}.png`, alt: '', width: 64, height: 64 }));
      const name = h('span', { class: 'vs-style-name' }, ic.label, ic.value === 'gold' ? h('span', { class: 'vs-style-default', text: 'Default' }) : null);
      return h('button', { type: 'button', role: 'radio', class: 'vs-style', 'aria-label': ic.label, 'data-value': ic.value }, preview, h('span', { class: 'hb-badge', 'aria-hidden': 'true' }, icon(ico.check)), name);
    });
    const group = h('div', { class: 'vs-styles vs-appicons', role: 'radiogroup', 'aria-label': 'App icon' }, ...tiles);
    const paint = (v: string): void => {
      for (const t of tiles) {
        const on = t.dataset.value === v;
        t.setAttribute('aria-checked', String(on));
        t.tabIndex = on ? 0 : -1;
      }
    };
    const choose = (t: HTMLElement, focus: boolean): void => {
      paint(t.dataset.value as string);
      if (focus) t.focus();
      ctx.set({ appIcon: t.dataset.value as Settings['appIcon'] });
    };
    for (const t of tiles) t.addEventListener('click', () => choose(t, false));
    group.addEventListener('keydown', (e) => {
      const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
      const j = ({ ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: tiles.length - 1 } as Record<string, number>)[e.key];
      if (i < 0 || j === undefined) return;
      e.preventDefault();
      choose(tiles[(j + tiles.length) % tiles.length], true);
    });
    ctx.bind((s) => paint(s.appIcon));
    const note = h('p', { class: 'vs-note', text: 'Shown on the taskbar, in Alt+Tab and on Deer’s Start menu and desktop shortcuts. A pinned taskbar icon can take a moment to change.' });
    return h('div', { class: 'vs-block vs-styleblock' }, group, note);
  },
};

const appearance: SectionDef = {
  id: 'appearance',
  title: 'Appearance',
  icon: nav.appearance,
  order: 20,
  groups: () => [
    { title: 'Theme', rows: [modeRow()] },
    { title: 'App icon', rows: [appIconRow] },
    {
      title: 'Tab bar',
      rows: [
        {
          title: 'Show the tab bar',
          desc: 'While you’re reading a page',
          keywords: 'auto-hide autohide hide tabs bar',
          build: (ctx) =>
            row({
              icon: ico.tabBar,
              title: 'Show the tab bar',
              desc: 'While you’re reading a page',
              control: (ids) =>
                dropdown(ctx, {
                  labelledBy: ids.title,
                  options: [
                    { value: 'always', label: 'Always' },
                    { value: 'auto', label: 'When I point at the top' },
                  ],
                  get: (s) => (s.barAutoHide ? 'auto' : 'always'),
                  set: (v) => ctx.set({ barAutoHide: v === 'auto' }),
                }),
            }),
        },
        {
          title: 'Start pages below the tab bar',
          desc: 'Leaves room at the top of each page; it scrolls away with the page',
          keywords: 'inset space gap top margin overlap cover header',
          build: (ctx) =>
            row({
              icon: ico.inset,
              title: 'Start pages below the tab bar',
              desc: 'Leaves room at the top of each page; it scrolls away with the page',
              control: (ids) => toggle(ctx, { labelledBy: ids.title, describedBy: ids.desc, get: (s) => s.pageInset, set: (v) => ctx.set({ pageInset: v }) }),
            }),
        },
      ],
    },
  ],
};

// ---- Home and background ----

const home: SectionDef = {
  id: 'home',
  title: 'Home and background',
  icon: nav.home,
  order: 30,
  groups: () => [
    {
      title: 'Background',
      rows: [
        {
          title: 'Background',
          desc: 'A photo, a video, your Windows wallpaper or none',
          keywords: 'wallpaper picture photo video image home none',
          build: (ctx) => {
            const picker = backgroundPicker(ctx.bg, 'panel');
            ctx.cleanup(picker.dispose);
            const head = row({ icon: ico.picture, title: 'Background', desc: 'What Home shows behind the tab bar', control: () => picker.tabs });
            return h('div', { class: 'vs-rows' }, head, h('div', { class: 'vs-block' }, picker.el));
          },
        },
        {
          title: 'Add your own',
          desc: 'A photo, or a video that plays muted and loops',
          keywords: 'browse file photo video wallpaper',
          build: (ctx) =>
            row({
              icon: ico.plusRow,
              title: 'Add your own',
              desc: 'A photo, or a video that plays muted and loops',
              control: (ids) => button('Browse', () => void ctx.bg.browse(), { describedBy: ids.desc, label: 'Browse for a photo or video' }),
            }),
        },
      ],
    },
  ],
};

// ---- Tabs ----

const STYLE_NOTES: Record<Settings['switcherStyle'], string> = {
  deck: 'Hold Ctrl and tap Tab. Big cards slide past, and the one you stop on opens when you let go.',
  grid: 'Hold Ctrl and tap Tab. Every tab shows as a card in a grid, and the one you stop on opens when you let go.',
  strip: 'Hold Ctrl and tap Tab. A row of small cards appears over the page, and the one you stop on opens when you let go.',
};

/** A span with inline layout (CSSOM, never a style attribute: see glass.ts). */
function box(css: string, ...children: Node[]): HTMLElement {
  const s = h('span', null, ...children);
  s.style.cssText = css;
  return s;
}

/** The style tiles' little pictures, drawn as on the SettingsTabs board (wallpaper when Windows has one). */
function stylePreview(style: Settings['switcherStyle'], wallpaper: string | null): Node[] {
  const photo = (blur: number, bright: number): Node => {
    if (wallpaper) {
      const img = h('img', { alt: '', draggable: 'false', decoding: 'async' });
      img.src = wallpaper;
      img.style.cssText = `position:absolute;left:-12px;top:-12px;width:229px;height:144px;object-fit:cover;filter:blur(${blur}px) brightness(${bright})`;
      return img;
    }
    // No wallpaper (a solid-colour desktop): Home's own base colour.
    return box(`position:absolute;inset:0;background:#2b2a2e;filter:brightness(${bright + 0.5})`);
  };
  /** The deck's front card shows a picture: the wallpaper itself when there is one. */
  const cardPicture = (): Node => {
    if (wallpaper) {
      const img = h('img', { alt: '', draggable: 'false', decoding: 'async' });
      img.src = wallpaper;
      img.style.cssText = 'display:block;width:105px;height:46px;object-fit:cover;border-radius:5px 5px 0 0';
      return img;
    }
    return box('display:block;width:105px;height:46px;border-radius:5px 5px 0 0;background:#6d8fb3');
  };
  const sel = 'box-shadow:0 0 0 1.5px var(--vs-accent)';
  if (style === 'deck') {
    const dots = [8, 24, 8, 8, 8, 8].map((w, i) => box(`width:${w}px;height:8px;border-radius:4px;background:rgba(255,255,255,${i === 1 ? 0.7 : 0.4})`));
    return [
      photo(6, 0.5),
      box('position:absolute;left:-36px;top:29px;width:66px;height:44px;border-radius:4px;background:#ece6da;opacity:.55'),
      box('position:absolute;left:175px;top:29px;width:66px;height:44px;border-radius:4px;background:#f4f2ec;opacity:.55'),
      box(
        'position:absolute;left:50px;top:18px;width:105px;height:66px;border-radius:5px;background:#0e0f12;box-shadow:0 6px 16px rgba(0,0,0,.45)',
        cardPicture(),
        box('display:block;margin:7px 8px 0;width:62px;height:4px;border-radius:2px;background:#fff;opacity:.7'),
      ),
      box('position:absolute;left:61px;top:96px;height:12px;padding:0 2px;border-radius:6px;display:flex;align-items:center;gap:3px;background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)', ...dots),
    ];
  }
  if (style === 'grid') {
    const colors = ['#ece6da', '#1b1d22', '#f4f2ec', '#f6f7f9', '#2a2a30', '#c9a37e'];
    const cells = colors.map((c, i) => box(`display:block;height:24px;border-radius:3px;background:${c};${i === 1 ? sel : ''}`));
    cells.push(box('display:block;height:24px;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)'));
    return [
      photo(8, 0.4),
      box('position:absolute;left:62px;top:9px;width:81px;height:10px;border-radius:5px;background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)'),
      box('position:absolute;left:18px;top:32px;width:169px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px', ...cells),
    ];
  }
  const strip = ['#ece6da', '#1b1d22', '#f4f2ec', '#f6f7f9', '#2a2a30'].map((c, i) => box(`display:block;width:27px;height:18px;border-radius:2px;background:${c};${i === 1 ? sel : ''}`));
  return [
    box('position:absolute;inset:0;background:#ece6da'),
    box('position:absolute;left:12px;top:12px;width:80px;height:8px;border-radius:2px;background:#1d1b18;opacity:.7'),
    box('position:absolute;left:12px;top:26px;width:120px;height:4px;border-radius:2px;background:#1d1b18;opacity:.2'),
    box('position:absolute;left:140px;top:12px;width:52px;height:40px;border-radius:2px;background:#1f4fd1'),
    box('position:absolute;inset:0;background:rgba(8,8,12,.2)'),
    box('position:absolute;left:16px;top:40px;width:173px;height:40px;padding:0 7px;border-radius:9px;display:flex;align-items:center;gap:5px;background:rgba(20,20,24,.68);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 6px 14px rgba(0,0,0,.35)', ...strip),
  ];
}

const switcherStyleRow: RowDef = {
  title: 'Tab switcher style',
  desc: 'Full-screen deck, Grid or Strip',
  keywords: 'ctrl+tab switcher deck grid strip cards switching',
  build: (ctx) => {
    const styles: { value: Settings['switcherStyle']; label: string }[] = [
      { value: 'deck', label: 'Full-screen deck' },
      { value: 'grid', label: 'Grid' },
      { value: 'strip', label: 'Strip' },
    ];
    const previews: HTMLElement[] = [];
    const tiles = styles.map((st) => {
      const preview = h('span', { class: 'vs-style-preview' }, ...stylePreview(st.value, null));
      previews.push(preview);
      const name = h('span', { class: 'vs-style-name' }, st.label, st.value === 'deck' ? h('span', { class: 'vs-style-default', text: 'Default' }) : null);
      return h('button', { type: 'button', role: 'radio', class: 'vs-style', 'aria-label': st.label, 'data-value': st.value }, preview, h('span', { class: 'hb-badge', 'aria-hidden': 'true' }, icon(ico.check)), name);
    });
    void ctx.bg.wallpapers().then((wp) => {
      const url = wp.windows ? fileURL(wp.windows) : '';
      if (url) previews.forEach((p, i) => p.replaceChildren(...stylePreview(styles[i].value, url)));
    });
    const note = h('p', { class: 'vs-note' });
    const group = h('div', { class: 'vs-styles', role: 'radiogroup', 'aria-label': 'Tab switcher style' }, ...tiles);
    const paint = (v: string): void => {
      for (const t of tiles) {
        const on = t.dataset.value === v;
        t.setAttribute('aria-checked', String(on));
        t.tabIndex = on ? 0 : -1;
      }
      note.textContent = STYLE_NOTES[v as Settings['switcherStyle']] ?? '';
    };
    const choose = (t: HTMLElement, focus: boolean): void => {
      paint(t.dataset.value as string);
      if (focus) t.focus();
      ctx.set({ switcherStyle: t.dataset.value as Settings['switcherStyle'] });
    };
    for (const t of tiles) t.addEventListener('click', () => choose(t, false));
    group.addEventListener('keydown', (e) => {
      const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
      const j = ({ ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: tiles.length - 1 } as Record<string, number>)[e.key];
      if (i < 0 || j === undefined) return;
      e.preventDefault();
      choose(tiles[(j + tiles.length) % tiles.length], true);
    });
    ctx.bind((s) => paint(s.switcherStyle));
    return h('div', { class: 'vs-block vs-styleblock' }, group, note);
  },
};

const tabs: SectionDef = {
  id: 'tabs',
  title: 'Tabs',
  icon: nav.tabs,
  order: 40,
  groups: () => [
    {
      title: 'Switching tabs',
      rows: [
        switcherStyleRow,
        {
          title: 'Order of tabs',
          desc: 'Ctrl+Tab starts at the tab you used before this one',
          keywords: 'ctrl+tab mru most recently used bar order',
          build: (ctx) => {
            const el = row({
              icon: ico.clock,
              title: 'Order of tabs',
              desc: ' ',
              control: (ids) =>
                dropdown(ctx, {
                  labelledBy: ids.title,
                  options: [
                    { value: 'recent', label: 'Most recently used' },
                    { value: 'bar', label: 'Tab bar order' },
                  ],
                  get: (s) => s.tabOrder,
                  set: (v) => ctx.set({ tabOrder: v }),
                }),
            });
            liveDesc(ctx, el, (s) => (s.tabOrder === 'bar' ? 'Ctrl+Tab starts at the tab on the right' : 'Ctrl+Tab starts at the tab you used before this one'));
            return el;
          },
        },
        {
          title: 'Type to search while switching',
          desc: 'Works in every style',
          keywords: 'switcher search filter type',
          build: (ctx) => {
            const el = row({
              icon: ico.searchRow,
              title: 'Type to search while switching',
              desc: ' ',
              control: (ids) => toggle(ctx, { labelledBy: ids.title, describedBy: ids.desc, get: (s) => s.typeToSearch, set: (v) => ctx.set({ typeToSearch: v }) }),
            });
            liveDesc(ctx, el, (s) => `Works in every style; ${fillKeys('{switcherSearch}', s.rebind)} opens it with search ready`);
            return el;
          },
        },
      ],
    },
    {
      title: 'Opening and closing tabs',
      rows: [
        choiceRow({
          icon: ico.closeCircle,
          title: 'Close button on tabs',
          desc: 'The × on a tab’s circle',
          keywords: 'close x hover',
          key: 'closeButton',
          options: [
            { value: 'hover', label: 'When I point at a tab' },
            { value: 'always', label: 'Always' },
          ],
        }),
        newTabRow(),
        choiceRow({
          icon: ico.selection,
          title: 'Searches from selected text',
          desc: 'Search for “…” in the right-click menu',
          keywords: 'selection peek context menu search for',
          key: 'selectionSearchOpens',
          options: [
            { value: 'peek', label: 'Open in a peek' },
            { value: 'tab', label: 'Open in a new tab' },
          ],
        }),
      ],
    },
  ],
};

// ---- Downloads ----

const CONNECTIONS = [1, 2, 4, 8, 16];
const SPEEDS = [0, 256, 512, 1024, 2048, 5120, 10240, 20480];

function speedLabel(kb: number): string {
  if (!kb) return 'No speed limit';
  return kb >= 1024 ? `${+(kb / 1024).toFixed(1)} MB/s` : `${kb} KB/s`;
}

const downloads: SectionDef = {
  id: 'downloads',
  title: 'Downloads',
  icon: nav.downloads,
  order: 50,
  groups: () => [
    { title: 'Location', rows: [folderRow(), askRow()] },
    {
      title: 'Speed',
      rows: [
        {
          title: 'Connections per download',
          desc: 'Big files arrive faster in parallel parts',
          keywords: 'parallel threads parts segments',
          build: (ctx) =>
            row({
              icon: ico.connections,
              title: 'Connections per download',
              desc: 'Big files arrive faster in parallel parts',
              control: (ids) =>
                dropdown(ctx, {
                  labelledBy: ids.title,
                  options: (s) => [...new Set([...CONNECTIONS, s.connections])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: n === 1 ? '1 connection' : `${n} connections` })),
                  get: (s) => String(s.connections),
                  set: (v) => ctx.set({ connections: Number(v) }),
                }),
            }),
        },
        {
          title: 'Limit speed',
          desc: 'Shared by every download',
          keywords: 'bandwidth throttle speed limit',
          build: (ctx) =>
            row({
              icon: ico.speed,
              title: 'Limit speed',
              desc: 'Shared by every download',
              control: (ids) =>
                dropdown(ctx, {
                  labelledBy: ids.title,
                  options: (s) => [...new Set([...SPEEDS, s.speedLimitKBps])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: speedLabel(n) })),
                  get: (s) => String(s.speedLimitKBps),
                  set: (v) => ctx.set({ speedLimitKBps: Number(v) }),
                }),
            }),
        },
      ],
    },
  ],
};

// ---- Privacy and security ----

/** Time ranges for Clear browsing data (Chrome's choices; Firefox's Sanitizer takes any range). */
const RANGES: (Option & { ms: number | null })[] = [
  { value: 'hour', label: 'Last hour', ms: 3600_000 },
  { value: 'day', label: 'Last 24 hours', ms: 86_400_000 },
  { value: 'week', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { value: 'month', label: 'Last 4 weeks', ms: 28 * 86_400_000 },
  { value: 'all', label: 'All time', ms: null },
];

/** [from, to] in microseconds (PRTime), as Sanitizer.getClearRange returns; null = everything. */
export function clearRange(value: string, now = Date.now()): [number, number] | null {
  const r = RANGES.find((x) => x.value === value) ?? RANGES[0];
  return r.ms === null ? null : [(now - r.ms) * 1000, now * 1000];
}

/** What each check box clears (Sanitizer items, browser/modules/Sanitizer.sys.mjs). */
const CLEAR_ITEMS: Record<'history' | 'cookies' | 'cache', SanitizeItem[]> = {
  // Visits, and what Firefox keeps with them; closed tabs are forgotten separately.
  history: ['history', 'formdata'],
  // Cookies, site storage, and sign-ins kept for the session (HTTP auth, tokens).
  cookies: ['cookies', 'offlineApps', 'sessions'],
  cache: ['cache'],
};

const clearRow: RowDef = {
  title: 'Clear browsing data',
  desc: 'History, cookies and site data, cached images and files',
  keywords: 'clear delete erase history cookies cache site data privacy time range',
  build: (ctx) => {
    const pick = { history: true, cookies: false, cache: true };
    let range = 'hour';
    const status = h('span', { class: 'vs-status', role: 'status', 'aria-live': 'polite' });
    const go = button('Clear data', () => void run(), { accent: true });
    go.dataset.action = 'clear-data';
    const paint = (): void => {
      go.disabled = !pick.history && !pick.cookies && !pick.cache;
    };
    const run = async (): Promise<void> => {
      go.disabled = true;
      status.textContent = 'Clearing…';
      const items: SanitizeItem[] = [];
      for (const k of ['history', 'cookies', 'cache'] as const) if (pick[k]) items.push(...CLEAR_ITEMS[k]);
      const label = RANGES.find((r) => r.value === range)?.label.toLowerCase() ?? '';
      try {
        await sanitize(items, clearRange(range));
        // Clearing history also empties Ctrl+Shift+T's list: "tabs you closed" is in the row's copy.
        if (pick.history) forgetClosedEverywhere();
        const done = [pick.history && 'browsing history', pick.cookies && 'cookies', pick.cache && 'cached files'].filter(Boolean) as string[];
        status.textContent = `Cleared ${done.join(', ').replace(/, ([^,]*)$/, ' and $1')}${range === 'all' ? '' : ` from the ${label}`}.`;
        status.dataset.done = String(Date.now());
      } catch (e) {
        console.error('Deer settings: clearing data failed', e);
        status.textContent = 'Something went wrong. Try again.';
        status.dataset.done = 'error';
      }
      paint();
    };
    const rangeRow = row({
      icon: ico.range,
      title: 'Time range',
      control: (ids) => localDropdown(ctx, { labelledBy: ids.title, options: RANGES, value: range, onChange: (v) => (range = v) }),
    });
    const rows = [
      rangeRow,
      checkRow({ id: 'history', title: 'Browsing history', desc: 'Sites you visited and tabs you closed', checked: pick.history, onChange: (v) => ((pick.history = v), paint()) }),
      checkRow({ id: 'cookies', title: 'Cookies and site data', desc: 'Signs you out of most sites', checked: pick.cookies, onChange: (v) => ((pick.cookies = v), paint()) }),
      checkRow({ id: 'cache', title: 'Cached images and files', desc: 'Some sites load more slowly the next time', checked: pick.cache, onChange: (v) => ((pick.cache = v), paint()) }),
      h('div', { class: 'vs-row vs-actions' }, status, go),
    ];
    paint();
    return h('div', { class: 'vs-rows vs-clear' }, ...rows);
  },
};

const privacy: SectionDef = {
  id: 'privacy',
  title: 'Privacy and security',
  icon: nav.privacy,
  order: 60,
  groups: () => [{ title: 'Clear browsing data', anchor: 'clear', rows: [clearRow] }],
};

// ---- Search engine ----

const search: SectionDef = {
  id: 'search',
  title: 'Search engine',
  icon: nav.search,
  order: 70,
  intro: 'Used when you search from the address field and from selected text.',
  groups: () => [
    {
      rows: [
        {
          title: 'Search engine',
          desc: ENGINES.map((e) => e.label).join(', '),
          keywords: 'google bing duckduckgo brave default search provider',
          build: (ctx) => radioRows(ctx, { label: 'Search engine', options: ENGINES, get: (s) => s.searchEngine, set: (v) => ctx.set({ searchEngine: v }) }),
        },
      ],
    },
  ],
};

// ---- About ----

/** Busy phases of the updater: "Check for updates" waits. */
const UPDATE_BUSY: UpdateState['phase'][] = ['checking', 'downloading', 'verifying', 'restarting'];

/**
 * The Updates card (VitreUpdater): the status line with "Check for updates" (or "Restart to update"
 * once a new version is downloaded), and the automatic check. A development build shows only why
 * updates are off: it never contacts anything.
 */
const updatesRow: RowDef = {
  title: 'Software update',
  desc: 'Check for updates, and let Deer check once a day',
  keywords: 'update updates upgrade new version check automatic automatically github release restart install',
  build: (ctx) => {
    const up = ctx.b.sys('VitreUpdater');
    let btn!: HTMLButtonElement;
    const status = row({
      icon: ico.update,
      title: 'Software update',
      desc: ' ',
      control: (ids) => {
        btn = button('Check for updates', () => {
          if (up.state().phase === 'ready') void up.restartToUpdate();
          else void up.check({ manual: true });
        }, { describedBy: ids.desc });
        btn.dataset.action = 'update';
        return btn;
      },
    });
    status.dataset.update = 'status';
    const line = status.querySelector('.vs-desc') as HTMLElement;
    line.setAttribute('role', 'status');
    line.setAttribute('aria-live', 'polite');
    const auto = row({
      icon: ico.clock,
      title: 'Check automatically',
      desc: 'Once a day, from Deer’s releases on GitHub',
      control: (ids) => localToggle(ctx, { labelledBy: ids.title, describedBy: ids.desc, get: () => up.state().auto, set: (v) => up.setAuto(v), subscribe: (fn) => up.onChange(fn) }),
    });
    auto.dataset.update = 'auto';
    const paint = (s: UpdateState): void => {
      line.textContent = updateStatus(s);
      status.dataset.phase = s.phase;
      btn.hidden = s.phase === 'off';
      btn.disabled = UPDATE_BUSY.includes(s.phase);
      btn.textContent = s.phase === 'ready' ? 'Restart to update' : 'Check for updates';
      btn.classList.toggle('accent', s.phase === 'ready');
      auto.hidden = !s.release;
    };
    paint(up.state());
    ctx.cleanup(up.onChange(paint));
    return h('div', { class: 'vs-rows' }, status, auto);
  },
};

const about: SectionDef = {
  id: 'about',
  title: 'About Deer',
  icon: nav.about,
  order: 90,
  intro: 'A see-through browser for Windows.',
  groups: () => [
    {
      rows: [
        {
          title: 'Version',
          keywords: 'about deer version gecko firefox engine data folder profile',
          build: (ctx) => {
            const info = engineInfo();
            // The installed deer-version.json's version, else the one built in (VitreUpdater reads it).
            const up = ctx.b.sys('VitreUpdater');
            const version = row({ icon: ico.vitre, title: 'Deer', desc: `Version ${up.state().version}` });
            const versionDesc = version.querySelector('.vs-desc') as HTMLElement;
            ctx.cleanup(up.onChange((s) => (versionDesc.textContent = `Version ${s.version}`)));
            const engine = row({ icon: ico.engine, title: 'Engine', desc: info.firefox ? `Gecko ${info.gecko}, from Firefox ${info.firefox}` : 'Gecko' });
            const data = row({
              icon: ico.data,
              title: 'Your data',
              desc: info.profile || ' ',
              control: (ids) => (info.profile ? button('Open folder', () => openFolder(info.profile), { describedBy: ids.desc, label: 'Open your data folder' }) : null),
            });
            data.querySelector('.vs-desc')?.classList.add('vs-path');
            return h('div', { class: 'vs-rows' }, version, engine, data);
          },
        },
      ],
    },
    { title: 'Updates', anchor: 'updates', rows: [updatesRow] },
  ],
};

export const BUILTIN_SECTIONS: SectionDef[] = [general, appearance, home, tabs, downloads, privacy, search, shortcutsSection, about];
