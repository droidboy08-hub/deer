"""One-off integration of the feature builders' core requests (kept for the record)."""
import os

os.chdir(os.path.join(os.path.dirname(__file__), '..'))


def patch(path, pairs):
    s = open(path, encoding='utf-8').read()
    for a, b in pairs:
        n = s.count(a)
        assert n == 1, (path, n, a[:90])
        s = s.replace(a, b)
    open(path, 'w', encoding='utf-8').write(s)


# shortcuts: F6 carries an arg; rebinding for Vitre's own verbs
patch('src/shared/shortcuts.ts', [
    ("  B('focusAddress', 'F6', 'browser'),\n  B('focusAddress', 'Shift+F6', 'browser'),",
     "  B('focusAddress', 'F6', 'browser', { arg: 6 }),\n  B('focusAddress', 'Shift+F6', 'browser', { arg: 6 }),"),
    ("/** Normalise a key event to the names used in BINDINGS. */",
     """const DEFAULT_BINDINGS = BINDINGS.map((b) => ({ ...b }));
/** Only Vitre's own verbs can be rebound (Settings › Keyboard shortcuts). */
export const REBINDABLE: ActionId[] = ['peekLink', 'switcherSearch', 'downloadVideo'];

/** Apply Settings › Keyboard shortcuts, e.g. { peekLink: 'Ctrl+K' } (spec format as in B()). */
export function applyRebind(rebind: Record<string, string> | undefined): void {
  BINDINGS.length = 0;
  for (const d of DEFAULT_BINDINGS) {
    const spec = rebind && REBINDABLE.includes(d.action) ? rebind[d.action] : undefined;
    BINDINGS.push(spec ? { ...B(d.action, spec, d.priority), arg: d.arg, repeat: d.repeat } : { ...d });
  }
}

/** Normalise a key event to the names used in BINDINGS. */"""),
])

# main: modules may take a key first; rebinding; history clear
patch('src/main/main.ts', [
    ("import { match } from '../shared/shortcuts';", "import { applyRebind, match } from '../shared/shortcuts';"),
    ("""    if (input.type === 'keyUp' && input.key === 'Control') {
      host.send('ctrl-up');
      return;
    }
    if (input.type !== 'keyDown') return;""", """    if (input.type === 'keyUp' && input.key === 'Control') {
      host.send('ctrl-up');
      return;
    }
    // A feature module (an open menu borrowing the page's keys) already took this key.
    if (e.defaultPrevented) return;
    if (input.type !== 'keyDown') return;"""),
    ("  wc.on('will-prevent-unload', (e) => {", """  // Pages need the current key rebinds for their page-first keys.
  wc.on('did-finish-load', () => {
    if (!wc.isDestroyed()) wc.send('vitre:rebind', settings?.get().rebind ?? {});
  });

  wc.on('will-prevent-unload', (e) => {"""),
    ("  ipcMain.handle('history:remove', (_e, url: string) => history.remove(url));",
     "  ipcMain.handle('history:remove', (_e, url: string) => history.remove(url));\n  ipcMain.handle('history:clear', (_e, since?: number) => history.clear(since ?? 0));"),
    ("  settings = new SettingsStore(settingsFile());", """  settings = new SettingsStore(settingsFile());
  applyRebind(settings.get().rebind);
  settings.onChange((s) => {
    applyRebind(s.rebind);
    for (const wc of webContents.getAllWebContents()) if (wc.getType() === 'webview' && !wc.isDestroyed()) wc.send('vitre:rebind', s.rebind);
  });"""),
])

patch('src/main/history.ts', [
    ("""  query(text: string, limit: number): HistoryEntry[] {""", """  /** Forget everything visited since `since` (ms); 0 clears all. */
  clear(since = 0): void {
    for (const [url, e] of this.byUrl) if (e.last >= since) this.byUrl.delete(url);
    this.save();
  }

  query(text: string, limit: number): HistoryEntry[] {"""),
])

patch('src/preload/chrome.ts', [
    ("    remove: (url) => ipcRenderer.invoke('history:remove', url) as Promise<void>,",
     "    remove: (url) => ipcRenderer.invoke('history:remove', url) as Promise<void>,\n    clear: (since?: number) => ipcRenderer.invoke('history:clear', since) as Promise<void>,"),
])
patch('src/shared/types.ts', [
    ("    remove(url: string): Promise<void>;\n  };", "    remove(url: string): Promise<void>;\n    clear(since?: number): Promise<void>;\n  };"),
])

patch('src/preload/page.ts', [
    ("import { match } from '../shared/shortcuts';", "import { applyRebind, match } from '../shared/shortcuts';"),
    ("window.addEventListener(\n  'keydown',", "ipcRenderer.on('vitre:rebind', (_e, rebind: Record<string, string>) => applyRebind(rebind));\n\nwindow.addEventListener(\n  'keydown',"),
])

# renderer core
patch('src/renderer/app.ts', [
    ("import { match, type ActionId } from '../shared/shortcuts';", "import { applyRebind, match, type ActionId } from '../shared/shortcuts';"),
    ("""    window.vitre.settings.onChange((s) => {
      this.settings = s;""", """    window.vitre.settings.onChange((s) => {
      this.settings = s;
      applyRebind(s.rebind);"""),
    ("""    this.settings = { ...DEFAULT_SETTINGS, ...(await window.vitre.settings.get()) };""", """    this.settings = { ...DEFAULT_SETTINGS, ...(await window.vitre.settings.get()) };
    applyRebind(this.settings.rebind);"""),
    ("""    const wl = await window.vitre.wallpaperLuma();
    this.homeTheme = wl !== null && wl > 0.62 ? 'light' : 'clear';""", """    if (this.settings.homeBackground.kind === 'windows') {
      const wl = await window.vitre.wallpaperLuma();
      this.homeTheme = wl !== null && wl > 0.62 ? 'light' : 'clear';
    }"""),
    ("""    const custom = this.actions.get(action);""", """    // Find keys go to the topmost surface: an open panel (Settings, Downloads) searches itself.
    if ((action === 'find' || action === 'findNext' || action === 'findPrev') && document.body.classList.contains('panel-open')) {
      document.dispatchEvent(new CustomEvent('vitre:panel-find'));
      return;
    }
    const custom = this.actions.get(action);"""),
    ("""      case 'back': if (wv?.canGoBack()) wv.goBack(); break;
      case 'forward': if (wv?.canGoForward()) wv.goForward(); break;""", """      case 'back': {
        // A focused peek gets Back first; on its first page Back closes it.
        const p = window.vitrePeek?.webview();
        if (p && document.activeElement === p) {
          if (p.canGoBack()) p.goBack();
          else window.vitrePeek?.close();
        } else if (wv?.canGoBack()) wv.goBack();
        break;
      }
      case 'forward': {
        const p = window.vitrePeek?.webview();
        if (p && document.activeElement === p) {
          if (p.canGoForward()) p.goForward();
        } else if (wv?.canGoForward()) wv.goForward();
        break;
      }"""),
    ("""        const inField = (e.target as HTMLElement)?.tagName === 'INPUT';""", """        // A Settings key-capture field takes every key itself.
        if ((e.target as HTMLElement)?.closest?.('[data-key-capture]')) return;
        const inField = (e.target as HTMLElement)?.tagName === 'INPUT';"""),
    ("""  escape(): boolean {""", """  /** Home's glass follows its background (light on bright wallpapers, clear on dark ones). */
  setHomeTheme(theme: Theme): void {
    this.homeTheme = theme;
    for (const t of this.tabs) if (t.kind === 'home') t.theme = theme;
    this.render();
  }

  escape(): boolean {"""),
])

# bar: an accessory slot in the pill for extension icons, and the download mark
patch('src/renderer/bar.ts', [
    ("""        <button type="button" class="address" aria-label="Edit address"><span class="fav"></span><span class="host"></span></button>
        <button type="button" class="nav reload" aria-label="Reload" title="Reload  Ctrl+R">${icons.reload}</button>""",
     """        <button type="button" class="address" aria-label="Edit address"><span class="fav"></span><span class="host"></span></button>
        <span class="accessories" role="group" aria-label="Extensions"></span>
        <button type="button" class="nav dl-mark" hidden></button>
        <button type="button" class="nav reload" aria-label="Reload" title="Reload  Ctrl+R">${icons.reload}</button>"""),
])
print('ok')
