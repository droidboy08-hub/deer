// The Settings pages. Every control reads and writes the real settings store; rows are
// declared once so "Find a setting" can list them on any page.
import { SEARCH_ENGINES, type Settings } from '../../../shared/settings';
import { backgroundPicker } from './bg-picker';
import { button, checkRow, dropdown, h, liveDesc, radioRows, row, segmented, toggle, type Ctx, type Option, type RowDef, type SectionDef } from './controls';
import { ico, nav } from './icons';
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
            const dir = (await window.vitre.ipc.invoke('settings:pick-folder', ctx.s().downloadsFolder)) as string | null;
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
  groups: () => [
    { title: 'Theme', rows: [modeRow(true)] },
    { title: 'Search', rows: [engineDropdownRow] },
    { title: 'Tabs', rows: [newTabRow(true)] },
    { title: 'Downloads', rows: [folderRow(true), askRow(true)] },
  ],
};

// ---- Appearance ----

const appearance: SectionDef = {
  id: 'appearance',
  title: 'Appearance',
  icon: nav.appearance,
  groups: () => [
    { title: 'Theme', rows: [modeRow()] },
    {
      title: 'Tab bar',
      rows: [
        {
          title: 'Show the tab bar',
          desc: 'While you’re reading a page',
          keywords: 'auto-hide hide tabs bar',
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
      ],
    },
  ],
};

// ---- Home and background ----

const home: SectionDef = {
  id: 'home',
  title: 'Home and background',
  icon: nav.home,
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
            const head = row({
              icon: ico.picture,
              title: 'Background',
              desc: 'What Home shows behind the tab bar',
              control: () => picker.el.querySelector('.hb-tabs'),
            });
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
              control: (ids) => button('Browse', () => void ctx.bg.browse('any'), { describedBy: ids.desc, label: 'Browse for a photo or video' }),
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

function stylePreview(style: Settings['switcherStyle'], wallpaper: string | null): string {
  const photo = (blur: number, bright: number) =>
    wallpaper
      ? `<img src="${wallpaper}" alt="" style="position:absolute;left:-12px;top:-12px;width:229px;height:144px;object-fit:cover;filter:blur(${blur}px) brightness(${bright})">`
      : `<span style="position:absolute;inset:0;background:radial-gradient(120% 90% at 30% 20%,#3c4d6b,#1d2230 60%,#141720);filter:brightness(${bright + 0.3})"></span>`;
  const sel = 'box-shadow:0 0 0 1.5px var(--vs-accent)';
  if (style === 'deck') {
    const dots = [8, 24, 8, 8, 8, 8].map((w, i) => `<span style="width:${w}px;height:8px;border-radius:4px;background:rgba(255,255,255,${i === 1 ? 0.7 : 0.4})"></span>`).join('');
    return `${photo(6, 0.5)}
      <span style="position:absolute;left:-36px;top:29px;width:66px;height:44px;border-radius:4px;background:#ece6da;opacity:.55"></span>
      <span style="position:absolute;left:175px;top:29px;width:66px;height:44px;border-radius:4px;background:#f4f2ec;opacity:.55"></span>
      <span style="position:absolute;left:50px;top:18px;width:105px;height:66px;border-radius:5px;background:#0e0f12;box-shadow:0 6px 16px rgba(0,0,0,.45)">
        <span style="display:block;width:105px;height:46px;border-radius:5px 5px 0 0;background:linear-gradient(180deg,#6d8fb3 0%,#c9a37e 72%,#4a4148 100%)"></span>
        <span style="display:block;margin:7px 8px 0;width:62px;height:4px;border-radius:2px;background:#fff;opacity:.7"></span>
      </span>
      <span style="position:absolute;left:61px;top:96px;height:12px;padding:0 2px;border-radius:6px;display:flex;align-items:center;gap:3px;background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)">${dots}</span>`;
  }
  if (style === 'grid') {
    const colors = ['#ece6da', '#1b1d22', '#f4f2ec', '#f6f7f9', '#2a2a30', '#c9a37e'];
    const cells = colors.map((c, i) => `<span style="height:24px;border-radius:3px;background:${c};${i === 1 ? sel : ''}"></span>`).join('');
    return `${photo(8, 0.4)}
      <span style="position:absolute;left:62px;top:9px;width:81px;height:10px;border-radius:5px;background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)"></span>
      <span style="position:absolute;left:18px;top:32px;width:169px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">${cells}<span style="height:24px;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)"></span></span>`;
  }
  const strip = ['#ece6da', '#1b1d22', '#f4f2ec', '#f6f7f9', '#2a2a30'].map((c, i) => `<span style="width:27px;height:18px;border-radius:2px;background:${c};${i === 1 ? sel : ''}"></span>`).join('');
  return `<span style="position:absolute;inset:0;background:#ece6da"></span>
    <span style="position:absolute;left:12px;top:12px;width:80px;height:8px;border-radius:2px;background:#1d1b18;opacity:.7"></span>
    <span style="position:absolute;left:12px;top:26px;width:120px;height:4px;border-radius:2px;background:#1d1b18;opacity:.2"></span>
    <span style="position:absolute;left:140px;top:12px;width:52px;height:40px;border-radius:2px;background:#1f4fd1"></span>
    <span style="position:absolute;inset:0;background:rgba(8,8,12,.2)"></span>
    <span style="position:absolute;left:16px;top:40px;width:173px;height:40px;padding:0 7px;box-sizing:border-box;border-radius:9px;display:flex;align-items:center;gap:5px;background:rgba(20,20,24,.68);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 6px 14px rgba(0,0,0,.35)">${strip}</span>`;
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
    const tiles = styles.map((st) => {
      const preview = h('span', { class: 'vs-style-preview' });
      const name = h('span', { class: 'vs-style-name' }, st.label, st.value === 'deck' ? h('span', { class: 'vs-style-default', text: 'Default' }) : null);
      const btn = h('button', { type: 'button', role: 'radio', class: 'vs-style', 'aria-label': st.label, 'data-value': st.value }, preview, h('span', { class: 'hb-badge', html: ico.check, 'aria-hidden': 'true' }), name);
      preview.innerHTML = stylePreview(st.value, null);
      return btn;
    });
    window.vitre
      .wallpaper()
      .then((wp) => wp && tiles.forEach((t, i) => (t.querySelector('.vs-style-preview')!.innerHTML = stylePreview(styles[i].value, wp))))
      .catch(() => undefined);
    const note = h('p', { class: 'vs-note' });
    const group = h('div', { class: 'vs-styles', role: 'radiogroup', 'aria-label': 'Tab switcher style', 'aria-describedby': undefined }, ...tiles);
    const paint = (v: string) => {
      for (const t of tiles) {
        const on = t.dataset.value === v;
        t.setAttribute('aria-checked', String(on));
        t.tabIndex = on ? 0 : -1;
      }
      note.textContent = STYLE_NOTES[v as Settings['switcherStyle']] ?? '';
    };
    const choose = (t: HTMLElement, focus: boolean) => {
      paint(t.dataset.value as string);
      if (focus) t.focus();
      ctx.set({ switcherStyle: t.dataset.value as Settings['switcherStyle'] });
    };
    for (const t of tiles) t.addEventListener('click', () => choose(t, false));
    group.addEventListener('keydown', (e) => {
      const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
      const j = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: tiles.length - 1 }[e.key];
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

async function clearHistory(): Promise<number> {
  const all = await window.vitre.history.query('', 100_000);
  // The core's History has no clear(); removing every entry goes through its own store.
  for (let i = 0; i < all.length; i += 200) await Promise.all(all.slice(i, i + 200).map((e) => window.vitre.history.remove(e.url)));
  return all.length;
}

const clearRow: RowDef = {
  title: 'Clear browsing data',
  desc: 'History, cookies and site data, cached images and files',
  keywords: 'clear delete erase history cookies cache site data privacy',
  build: (ctx) => {
    const pick = { history: true, cookies: false, cache: true };
    const status = h('span', { class: 'vs-status', role: 'status', 'aria-live': 'polite' });
    const go = button('Clear data', () => void run(), { accent: true });
    const paint = () => {
      go.disabled = !pick.history && !pick.cookies && !pick.cache;
    };
    const run = async () => {
      go.disabled = true;
      status.textContent = 'Clearing…';
      const tasks: Promise<unknown>[] = [];
      if (pick.history) {
        ctx.b.closedStack.length = 0;
        tasks.push(clearHistory());
      }
      if (pick.cookies || pick.cache) tasks.push(window.vitre.ipc.invoke('app:clear-data', { cookies: pick.cookies, cache: pick.cache }));
      try {
        await Promise.all(tasks);
        const done = [pick.history && 'browsing history', pick.cookies && 'cookies', pick.cache && 'cached files'].filter(Boolean) as string[];
        status.textContent = `Cleared ${done.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
      } catch {
        status.textContent = 'Something went wrong. Try again.';
      }
      paint();
    };
    const rows = [
      checkRow({ title: 'Browsing history', desc: 'Sites you visited and tabs you closed', checked: pick.history, onChange: (v) => ((pick.history = v), paint()) }),
      checkRow({ title: 'Cookies and site data', desc: 'Signs you out of most sites', checked: pick.cookies, onChange: (v) => ((pick.cookies = v), paint()) }),
      checkRow({ title: 'Cached images and files', desc: 'Some sites load more slowly the next time', checked: pick.cache, onChange: (v) => ((pick.cache = v), paint()) }),
      h('div', { class: 'vs-row vs-actions' }, status, go),
    ];
    paint();
    return h('div', { class: 'vs-rows' }, ...rows);
  },
};

const privacy: SectionDef = {
  id: 'privacy',
  title: 'Privacy and security',
  icon: nav.privacy,
  groups: () => [{ title: 'Clear browsing data', anchor: 'clear', rows: [clearRow] }],
};

// ---- Search engine ----

const search: SectionDef = {
  id: 'search',
  title: 'Search engine',
  icon: nav.search,
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

interface About {
  version: string;
  electron: string;
  chrome: string;
  userData: string;
}

const about: SectionDef = {
  id: 'about',
  title: 'About Vitre',
  icon: nav.about,
  intro: 'A see-through browser for Windows.',
  groups: () => [
    {
      rows: [
        {
          title: 'Version',
          keywords: 'about version chromium electron engine data folder',
          build: () => {
            const version = row({ icon: ico.vitre, title: 'Vitre', desc: ' ' });
            const engine = row({ icon: ico.engine, title: 'Engine', desc: ' ' });
            const data = row({
              icon: ico.data,
              title: 'Your data',
              desc: ' ',
              control: (ids) => button('Open folder', () => void window.vitre.ipc.invoke('app:open-data-folder'), { describedBy: ids.desc, label: 'Open your data folder' }),
            });
            data.querySelector('.vs-desc')?.classList.add('vs-path');
            (window.vitre.ipc.invoke('app:about') as Promise<About>)
              .then((a) => {
                version.querySelector('.vs-desc')!.textContent = `Version ${a.version}`;
                engine.querySelector('.vs-desc')!.textContent = `Chromium ${a.chrome}, through Electron ${a.electron}`;
                data.querySelector('.vs-desc')!.textContent = a.userData;
              })
              .catch(() => undefined);
            return h('div', { class: 'vs-rows' }, version, engine, data);
          },
        },
      ],
    },
  ],
};

export const SECTIONS: SectionDef[] = [general, appearance, home, tabs, downloads, privacy, search, shortcutsSection, about];
