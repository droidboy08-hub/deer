// Settings › Video downloads: where ffmpeg is (the one setting of the downloader the Settings
// module's own Downloads page does not have). The four download fields (downloadsFolder,
// askWhereToSave, connections, speedLimitKBps) are on that built-in page (settings/pages.ts) and
// the engine reads them live. Registered through the 'settings' service when it is there, built
// with the panel's own classes (settings/index.ts header).
import type { Browser } from '../../browser';
import { el, svg } from '../../dom';
import { ic } from './icons';

export function registerSettingsPage(b: Browser): void {
  // Typed by the provider (settings/index.ts SettingsApi); never resolves in a build without Settings.
  void b.whenService('settings').then((api) => {
    if (!api || typeof api.registerPage !== 'function') return;
    try {
      b.onDestroy(
        api.registerPage({
          id: 'video-downloads',
          title: 'Video downloads',
          icon: ic.video,
          order: 51,
          keywords: 'ffmpeg yt-dlp youtube deno download install get update join merge video audio sound hls dash stream mp4 drm protected',
          render: (host) => render(b, host),
        })
      );
    } catch (e) {
      console.warn('Deer downloads: could not add the settings page', String(e));
    }
  });
}

function render(b: Browser, host: HTMLElement): () => void {
  const engine = b.sys('VitreDownloads');
  const status = el('span', { class: 'vs-desc vs-path' });
  const choose = el('button', { type: 'button', class: 'vs-btn' }, 'Choose…');
  const auto = el('button', { type: 'button', class: 'vs-btn subtle' }, 'Look automatically');
  const row = el(
    'div',
    { class: 'vs-row has-ico' },
    el('span', { class: 'vs-ico' }, svg(ic.video.replace('width="18" height="18"', 'width="20" height="20"'))),
    el('div', { class: 'vs-text' }, el('span', { class: 'vs-title', id: 'vd-ff-title' }, 'ffmpeg'), status),
    auto,
    choose
  );
  // Getting ffmpeg without leaving Deer: shown while there is none, and while an install runs.
  const getStatus = el('span', { class: 'vs-desc', id: 'vd-ff-get-status' });
  const get = el('button', { type: 'button', class: 'vs-btn accent', id: 'vd-ff-get' }, 'Download');
  const stop = el('button', { type: 'button', class: 'vs-btn subtle', id: 'vd-ff-stop' }, 'Cancel');
  const getRow = el(
    'div',
    { class: 'vs-row has-ico', id: 'vd-ff-get-row' },
    el('span', { class: 'vs-ico' }, svg(ic.download(20))),
    el('div', { class: 'vs-text' }, el('span', { class: 'vs-title' }, 'Download ffmpeg'), getStatus),
    stop,
    get
  );
  // yt-dlp and Deno, for sites that never play from a file address (YouTube).
  const ytStatus = el('span', { class: 'vs-desc', id: 'vd-yt-status' });
  const ytGet = el('button', { type: 'button', class: 'vs-btn accent', id: 'vd-yt-get' }, 'Download');
  const ytStop = el('button', { type: 'button', class: 'vs-btn subtle', id: 'vd-yt-stop' }, 'Cancel');
  const ytRow = el(
    'div',
    { class: 'vs-row has-ico', id: 'vd-yt-row' },
    el('span', { class: 'vs-ico' }, svg(ic.download(20))),
    el('div', { class: 'vs-text' }, el('span', { class: 'vs-title' }, 'yt-dlp'), ytStatus),
    ytStop,
    ytGet
  );
  host.append(
    el('h2', { class: 'vs-h2' }, 'Joining video and sound'),
    el('div', { class: 'vs-card' }, row, getRow),
    el(
      'p',
      { class: 'vs-intro' },
      'Streams often keep the picture and the sound apart. Deer joins them with ffmpeg without re-encoding anything. It uses the file you choose here, otherwise a copy beside Deer or one Deer downloaded, otherwise one on your PATH. If you have none, Deer can download it for you. Without it, the two parts are saved as separate files.'
    ),
    el('h2', { class: 'vs-h2' }, 'YouTube and other video sites'),
    el('div', { class: 'vs-card' }, ytRow),
    el(
      'p',
      { class: 'vs-intro' },
      'Some sites, YouTube first, never play from a file address, so there is nothing in the page Deer could save. yt-dlp asks those sites for the video itself; it needs Deno, a JavaScript engine, for YouTube. Deer gets both from their GitHub releases (about 60 MB), checks them against their published fingerprints and keeps them in its own folder. Sites change often: update yt-dlp when a site stops working.'
    ),
    el('h2', { class: 'vs-h2' }, 'Protected video'),
    el('p', { class: 'vs-intro' }, 'Video protected by DRM (as on Netflix or Spotify) is never offered or saved. Some sites’ terms forbid saving their videos: Deer reminds you once per site.')
  );
  let alive = true;
  let ytInstalled = engine.hasYtdlp();
  const paintYt = (): void => {
    const s = engine.ytdlpInstall();
    const busy = s.phase === 'checking' || s.phase === 'downloading' || s.phase === 'verifying' || s.phase === 'unpacking';
    let text = ytInstalled ? ytVersion || 'Installed' : 'Not installed';
    if (s.phase === 'checking') text = 'Looking for the newest releases…';
    else if (s.phase === 'downloading') text = s.total > 0 ? `Downloading ${s.tool}… ${mb(s.received)} of ${mb(s.total)} MB` : `Downloading ${s.tool}…`;
    else if (s.phase === 'verifying') text = `Checking ${s.tool}…`;
    else if (s.phase === 'unpacking') text = `Unpacking ${s.tool}…`;
    else if (s.phase === 'failed') text = `Couldn’t install: ${s.error}.`;
    ytStatus.textContent = text;
    ytStatus.classList.toggle('vd-ff-missing', s.phase === 'failed');
    ytGet.hidden = busy;
    ytGet.textContent = s.phase === 'failed' ? 'Try again' : ytInstalled ? 'Update' : 'Download';
    ytGet.classList.toggle('accent', !ytInstalled);
    ytStop.hidden = !busy || s.phase === 'unpacking';
  };
  let ytVersion = '';
  const readYtVersion = async (): Promise<void> => {
    ytInstalled = engine.hasYtdlp();
    ytVersion = ytInstalled ? await engine.ytdlpVersion() : '';
    if (alive) paintYt();
  };
  paintYt();
  void readYtVersion();
  ytGet.addEventListener('click', () => {
    engine
      .installYtdlp(ytInstalled)
      .then(() => readYtVersion())
      .catch(() => undefined); // the state says what happened
  });
  ytStop.addEventListener('click', () => engine.cancelYtdlpInstall());
  const offYt = engine.onYtdlpInstall(() => {
    if (alive) paintYt();
  });
  let found = true;
  const mb = (n: number): string => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1);
  const paintGet = (): void => {
    const s = engine.ffmpegInstall();
    const busy = s.phase === 'checking' || s.phase === 'downloading' || s.phase === 'verifying' || s.phase === 'unpacking';
    getRow.hidden = found && !busy && s.phase !== 'failed';
    const name = s.version ? `FFmpeg ${s.version}` : 'FFmpeg';
    let text = 'The free LGPL build from BtbN’s FFmpeg Builds on GitHub, the Windows build ffmpeg.org points to. About 75 MB, checked against its published fingerprint and kept in Deer’s folder.';
    if (s.phase === 'checking') text = 'Looking for the newest release…';
    else if (s.phase === 'downloading') text = s.total > 0 ? `Downloading ${name}… ${mb(s.received)} of ${mb(s.total)} MB` : `Downloading ${name}…`;
    else if (s.phase === 'verifying') text = `Checking ${name}…`;
    else if (s.phase === 'unpacking') text = `Unpacking ${name}…`;
    else if (s.phase === 'failed') text = `Couldn’t install ffmpeg: ${s.error}.`;
    getStatus.textContent = text;
    getStatus.classList.toggle('vd-ff-missing', s.phase === 'failed');
    get.hidden = busy;
    get.textContent = s.phase === 'failed' ? 'Try again' : 'Download';
    stop.hidden = !busy || s.phase === 'unpacking';
  };
  const paint = async (): Promise<void> => {
    const info = await engine.ffmpeg();
    if (!alive) return;
    const setting = String(b.settings.ffmpegPath ?? '');
    let text = '';
    if (info.path) text = `${info.source === 'settings' ? 'Using' : info.source === 'bundled' ? 'Found beside Deer:' : info.source === 'downloaded' ? 'Downloaded copy:' : 'Found on PATH:'} ${info.path}`;
    else text = 'ffmpeg not found';
    if (info.settingBroken) text = `The file chosen here is missing (${setting}). ${info.path ? text : 'ffmpeg not found'}`;
    status.textContent = text;
    status.classList.toggle('vd-ff-missing', !info.path);
    auto.hidden = !setting;
    found = !!info.path;
    paintGet();
  };
  paintGet();
  void paint();
  get.addEventListener('click', () => {
    engine.installFfmpeg().catch(() => undefined); // the state says what happened
  });
  stop.addEventListener('click', () => engine.cancelFfmpegInstall());
  const offInstall = engine.onFfmpegInstall(() => {
    if (alive) paintGet();
  });
  choose.addEventListener('click', async () => {
    const path = await engine.pickProgram(window, { dir: String(b.settings.ffmpegPath ?? '') ? String(b.settings.ffmpegPath).replace(/[\\/][^\\/]*$/, '') : '' });
    if (path) b.sys('VitreSettings').set({ ffmpegPath: path });
  });
  auto.addEventListener('click', () => b.sys('VitreSettings').set({ ffmpegPath: '' }));
  const off = b.on('settings', (_s, changed) => {
    if (changed.includes('ffmpegPath')) void paint();
  });
  return () => {
    alive = false;
    off();
    offInstall();
    offYt();
  };
}
