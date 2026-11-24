// Firefox Account & Sync settings page.
// Integrates with Firefox Accounts (FxAccounts) and Firefox Sync (Weave) in the Gecko runtime.
import type { Browser } from '../../browser';
import { button, h, iconBox, localToggle, row, type Ctx, type GroupDef, type RowDef, type SectionDef } from './controls';
import { getBoolPref, openBookmarksOrganizer, openSavedLogins, prefSubscriber, setBoolPref } from './gecko';
import { ico, nav } from './icons';

export interface AccountState {
  signedIn: boolean;
  email: string;
  displayName: string;
  avatar: string;
  lastSync: number;
  syncing: boolean;
}

let isSyncing = false;
const syncListeners = new Set<() => void>();

export function onSyncStateChange(fn: () => void): () => void {
  syncListeners.add(fn);
  return () => syncListeners.delete(fn);
}

function notifySyncListeners(): void {
  for (const fn of syncListeners) {
    try {
      fn();
    } catch (e) {
      console.warn('Deer sync listener failed', e);
    }
  }
}

// Global observers for Firefox Sync and Account events
try {
  const syncObserver = {
    observe(_subject: any, topic: string) {
      if (topic === 'weave:service:sync:start') {
        isSyncing = true;
      } else if (topic === 'weave:service:sync:finish' || topic === 'weave:service:sync:error') {
        isSyncing = false;
      }
      notifySyncListeners();
    },
  };
  Services.obs.addObserver(syncObserver, 'sync-ui-state:update');
  Services.obs.addObserver(syncObserver, 'weave:service:sync:start');
  Services.obs.addObserver(syncObserver, 'weave:service:sync:finish');
  Services.obs.addObserver(syncObserver, 'weave:service:sync:error');
} catch (e) {
  console.warn('Deer sync: could not register sync observers', e);
}

function getUIState(): any {
  try {
    return ChromeUtils.importESModule('resource://services-sync/UIState.sys.mjs').UIState;
  } catch {
    return null;
  }
}

function getWeave(): any {
  try {
    return ChromeUtils.importESModule('resource://services-sync/main.sys.mjs').Weave;
  } catch {
    return null;
  }
}

function getFxAccountsModule(): any {
  try {
    return ChromeUtils.importESModule('resource://gre/modules/FxAccounts.sys.mjs');
  } catch {
    return null;
  }
}

function getFxAccountsConfig(): any {
  try {
    const mod = getFxAccountsModule();
    return mod?.FxAccounts?.config ?? mod?.getFxAccountsSingleton?.()?.config;
  } catch {
    return null;
  }
}

export function currentAccountState(): AccountState {
  const ui = getUIState();
  let signedIn = false;
  let email = '';
  let displayName = '';
  let avatar = '';
  let lastSync = 0;
  if (ui) {
    try {
      const s = ui.get();
      signedIn = s.status === ui.STATUS_SIGNED_IN;
      email = s.email || '';
      displayName = s.displayName || s.email || '';
      avatar = s.avatar || '';
      if (s.lastSync) lastSync = new Date(s.lastSync).getTime();
    } catch {}
  }
  return {
    signedIn,
    email,
    displayName,
    avatar,
    lastSync,
    syncing: isSyncing,
  };
}

export function syncNavTitle(): string {
  const state = currentAccountState();
  if (state.signedIn) {
    return state.displayName || state.email || 'Firefox Sync';
  }
  return 'Sign in';
}

export async function getSignInUrl(action: 'email' | 'signup' = 'email'): Promise<string> {
  try {
    const config = getFxAccountsConfig();
    if (config?.promiseConnectAccountURI) {
      const url = await config.promiseConnectAccountURI('sync', 'preferences', { action });
      if (url) return url;
    }
  } catch (e) {
    console.warn('Deer sync: promiseConnectAccountURI failed', e);
  }
  return `https://accounts.firefox.com/?action=${action}&entrypoint=preferences&service=sync&context=fx_desktop_v3`;
}

export async function getManageUrl(): Promise<string> {
  try {
    const config = getFxAccountsConfig();
    if (config?.promiseManageURI) {
      const url = await config.promiseManageURI('preferences');
      if (url) return url;
    }
  } catch (e) {
    console.warn('Deer sync: promiseManageURI failed', e);
  }
  return 'https://accounts.firefox.com/settings';
}

export async function signIn(b: Browser): Promise<void> {
  b.service('settings')?.close();
  const url = await getSignInUrl('email');
  b.newTab(url);
}

export async function createAccount(b: Browser): Promise<void> {
  b.service('settings')?.close();
  const url = await getSignInUrl('signup');
  b.newTab(url);
}

export async function manageAccount(b: Browser): Promise<void> {
  b.service('settings')?.close();
  const url = await getManageUrl();
  b.newTab(url);
}

export async function syncNow(): Promise<void> {
  const weave = getWeave();
  if (weave?.Service) {
    isSyncing = true;
    notifySyncListeners();
    try {
      await weave.Service.sync({ why: 'user' });
    } catch (e) {
      console.warn('Deer syncNow failed', e);
    } finally {
      isSyncing = false;
      notifySyncListeners();
    }
  }
}

export async function signOut(): Promise<void> {
  let disconnected = false;
  try {
    const { SyncDisconnect } = ChromeUtils.importESModule('resource://services-sync/SyncDisconnect.sys.mjs');
    if (SyncDisconnect?.disconnect) {
      await SyncDisconnect.disconnect(false);
      disconnected = true;
    }
  } catch (e) {
    console.warn('Deer SyncDisconnect failed, falling back to manual disconnect', e);
  }

  if (!disconnected) {
    try {
      const weave = getWeave();
      if (weave?.Service) {
        await weave.Service.promiseInitialized;
        await weave.Service.startOver();
      }
    } catch (we) {
      console.warn('Deer weave startOver failed', we);
    }
    try {
      const mod = getFxAccountsModule();
      const fxa = mod?.getFxAccountsSingleton?.();
      if (fxa?.signOut) {
        await fxa.signOut();
      }
    } catch (fe) {
      console.warn('Deer fxAccounts.signOut failed', fe);
    }
  }

  isSyncing = false;
  notifySyncListeners();
}

export function timeAgo(ms: number): string {
  if (!ms) return 'Never';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'Just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function engineRow(ctx: Ctx, title: string, desc: string, prefKey: string, iconMarkup: string): RowDef {
  return {
    title,
    desc,
    keywords: `sync ${title.toLowerCase()}`,
    build: () =>
      row({
        icon: iconMarkup,
        title,
        desc,
        control: (ids) =>
          localToggle(ctx, {
            labelledBy: ids.title,
            describedBy: ids.desc,
            get: () => getBoolPref(prefKey, true),
            set: (v) => setBoolPref(prefKey, v),
            subscribe: prefSubscriber(prefKey),
          }),
      }),
  };
}

export function syncGroups(ctx: Ctx): GroupDef[] {
  const st = currentAccountState();

  if (!st.signedIn) {
    // --- Signed-Out State ---
    const heroRow: RowDef = {
      title: 'Sign in to Firefox',
      keywords: 'firefox sync sign in login account connect profile',
      build: () => {
        const iconEl = h('div', { class: 'vs-sync-hero-ico' }, iconBox(ico.account, 'vs-ico'));
        const titleEl = h('div', { class: 'vs-sync-hero-title', text: 'Sync your Firefox profile' });
        const descEl = h('div', {
          class: 'vs-sync-hero-desc',
          text: 'Sign in with your Firefox Account to access your bookmarks, passwords, history, and open tabs in Deer and across all your devices.',
        });
        const textCol = h('div', { class: 'vs-sync-hero-text' }, titleEl, descEl);
        const topRow = h('div', { class: 'vs-sync-hero-top' }, iconEl, textCol);

        const signInBtn = h('button', {
          type: 'button',
          class: 'vs-btn accent',
          text: 'Sign in to Firefox',
          onclick: () => void signIn(ctx.b),
        });
        const createBtn = h('button', {
          type: 'button',
          class: 'vs-btn',
          text: 'Create account',
          onclick: () => void createAccount(ctx.b),
        });
        const btnsRow = h('div', { class: 'vs-sync-hero-btns' }, signInBtn, createBtn);

        return h('div', { class: 'vs-sync-hero' }, topRow, btnsRow);
      },
    };

    const staticItems: RowDef[] = [
      {
        title: 'Bookmarks',
        desc: 'Folders, bookmarks, and mobile bookmarks sync seamlessly.',
        build: () => row({ icon: ico.bookmark, title: 'Bookmarks', desc: 'Folders, bookmarks, and mobile bookmarks sync seamlessly.' }),
      },
      {
        title: 'Logins and passwords',
        desc: 'Saved website passwords sync with end-to-end encryption.',
        build: () => row({ icon: ico.key, title: 'Logins and passwords', desc: 'Saved website passwords sync with end-to-end encryption.' }),
      },
      {
        title: 'Browsing history',
        desc: 'Access your recently visited pages and search history.',
        build: () => row({ icon: ico.history, title: 'Browsing history', desc: 'Access your recently visited pages and search history.' }),
      },
      {
        title: 'Open tabs',
        desc: 'Pick up tabs left open on your phone or other computers.',
        build: () => row({ icon: ico.tabBar, title: 'Open tabs', desc: 'Pick up tabs left open on your phone or other computers.' }),
      },
    ];

    return [
      { rows: [heroRow] },
      { title: 'What syncs with your account', rows: staticItems },
    ];
  }

  // --- Signed-In State ---
  const profileRow: RowDef = {
    title: 'Firefox Account',
    keywords: 'firefox sync account email profile sign out',
    build: () => {
      const avatarEl = st.avatar
        ? h('div', { class: 'vs-sync-avatar' }, h('img', { src: st.avatar, alt: st.displayName || st.email }))
        : h('div', { class: 'vs-sync-avatar', text: (st.displayName || st.email || 'F')[0].toUpperCase() });

      const nameEl = h('div', { class: 'vs-sync-name', text: st.displayName || st.email });
      const emailEl = st.displayName && st.displayName !== st.email ? h('div', { class: 'vs-sync-email', text: st.email }) : null;

      const dot = h('span', { class: 'vs-sync-dot' });
      const statusText = h('span', { text: `Connected · Last synced ${timeAgo(st.lastSync)}` });
      const statusEl = h('div', { class: 'vs-sync-status' }, dot, statusText);

      const textCol = h('div', { class: 'vs-sync-profile-text' }, nameEl, emailEl, statusEl);

      const syncBtn = h('button', {
        type: 'button',
        class: 'vs-btn accent',
        text: st.syncing ? 'Syncing…' : 'Sync now',
        disabled: st.syncing,
        onclick: async () => {
          syncBtn.setAttribute('disabled', 'true');
          syncBtn.textContent = 'Syncing…';
          await syncNow();
        },
      });

      const manageBtn = h('button', {
        type: 'button',
        class: 'vs-btn subtle',
        text: 'Manage',
        onclick: () => void manageAccount(ctx.b),
      });

      const signOutBtn = h('button', {
        type: 'button',
        class: 'vs-btn subtle',
        text: 'Sign out',
        onclick: async () => {
          signOutBtn.setAttribute('disabled', 'true');
          signOutBtn.textContent = 'Signing out…';
          try {
            await signOut();
          } catch (e) {
            console.error('Deer signOut failed', e);
            signOutBtn.removeAttribute('disabled');
            signOutBtn.textContent = 'Sign out';
          }
        },
      });

      const btnsRow = h('div', { class: 'vs-sync-profile-btns' }, syncBtn, manageBtn, signOutBtn);

      return h('div', { class: 'vs-sync-profile' }, avatarEl, textCol, btnsRow);
    },
  };

  const syncEngineRows: RowDef[] = [
    engineRow(ctx, 'Bookmarks', 'Sync your bookmarks and bookmark folders', 'services.sync.engine.bookmarks', ico.bookmark),
    engineRow(ctx, 'History', 'Sync visited pages and address bar history', 'services.sync.engine.history', ico.history),
    engineRow(ctx, 'Logins and passwords', 'Sync saved usernames and passwords', 'services.sync.engine.passwords', ico.key),
    engineRow(ctx, 'Open tabs', 'Sync active tabs from your other devices', 'services.sync.engine.tabs', ico.tabBar),
    engineRow(ctx, 'Add-ons', 'Sync installed browser extensions', 'services.sync.engine.addons', ico.engine),
  ];

  const deviceName = Services.prefs.getStringPref('services.sync.client.name', 'Deer on Mac');
  const deviceRow: RowDef = {
    title: 'Device name',
    desc: deviceName,
    keywords: 'device name sync client',
    build: () =>
      row({
        icon: ico.vitre,
        title: 'Device name',
        desc: deviceName,
      }),
  };

  const dataAccessRows: RowDef[] = [
    {
      title: 'Saved logins and passwords',
      desc: 'Open Firefox Lockwise password manager to view, copy, or edit credentials',
      keywords: 'saved logins passwords credentials about:logins',
      build: () =>
        row({
          icon: ico.key,
          title: 'Saved logins and passwords',
          desc: 'Open Firefox Lockwise password manager to view, copy, or edit credentials',
          control: () => button('Saved Logins…', () => openSavedLogins(ctx.b)),
        }),
    },
    {
      title: 'Bookmarks library',
      desc: 'Open Places Bookmarks organizer to view, sort, and organize folders',
      keywords: 'bookmarks library organizer places folders',
      build: () =>
        row({
          icon: ico.bookmark,
          title: 'Bookmarks library',
          desc: 'Open Places Bookmarks organizer to view, sort, and organize folders',
          control: () => button('Manage Bookmarks…', () => openBookmarksOrganizer()),
        }),
    },
  ];

  return [
    { rows: [profileRow] },
    { title: 'Sync items', rows: syncEngineRows },
    { title: 'Manage synced data', rows: dataAccessRows },
    { title: 'Device', rows: [deviceRow] },
  ];
}

export const syncSection: SectionDef = {
  id: 'sync',
  get title() {
    return syncNavTitle();
  },
  icon: nav.account,
  order: 5,
  header: () => {
    const st = currentAccountState();
    return h('div', { class: 'vs-headrow' },
      h('h1', { class: 'vs-h1', id: 'vs-h1', text: st.signedIn ? 'Firefox Sync' : 'Sign in to Firefox' })
    );
  },
  intro: 'Sync your bookmarks, history, passwords, and open tabs across devices with your Firefox Account.',
  keywords: 'sync account firefox login password bookmarks tabs history sign in connect',
  groups: (ctx) => syncGroups(ctx),
};
