// Settings › Keyboard shortcuts: the whole map, grouped as in design/keymap.json, with the
// Shift+click switch, the Caret browsing switch, "Different from Chrome", and key capture for
// Deer's own four verbs.
// Ported from app/src/renderer/modules/settings/shortcuts-page.ts.
//
// Capture: the field carries [data-key-capture], so the key router (src/window/keys.ts) leaves
// every key alone while it has focus; the field reads raw keydowns and preventDefault()s them.
// Esc cancels (the field's own keydown, and an Esc layer at 55 for an Esc that arrives another way);
// Tab or a click elsewhere cancels too. A saved key goes to settings.rebind; every window's router
// applies it (shortcuts.ts applyRebind) from the 'settings' event.
import type { Settings } from '../../../shared/settings';
import { setTip } from '../../tips';
import { conflictFor, readCapture } from './capture';
import { h, iconBox, row, segmented, toggle, uid, type Ctx, type GroupDef, type RowDef, type SectionDef } from './controls';
import { caretBrowsing, onCaretBrowsingChange, setCaretBrowsing } from './gecko';
import { ico, nav } from './icons';
import { DIFFERENT_FROM_CHROME, KEY_GROUPS, REBINDABLE, currentSpec, displaySpec, fillKeys, normalizeKeys, type KeyRow, type RebindId } from './keymap';

/** Escape-ladder priority while a key is being captured: before the panel itself (60). */
export const CAPTURE_ESC_PRIORITY = 55;

/** The one key capture that may be running; the panel asks it before acting on Esc or Ctrl+W. */
export const capture = {
  active: null as null | { id: RebindId; cancel(focusKey: boolean): void },
};

/** Is a new key being captured right now (the capture field has focus)? */
export function capturing(): boolean {
  return !!capture.active && !!(document.activeElement as HTMLElement | null)?.closest('[data-key-capture]');
}

/** One-line notes left by the last change (a site or a GPU tool may use the key), for that key. */
const warnings = new Map<RebindId, { spec: string; text: string }>();

/** The warning for a verb's current key, if it was given for that key. */
function warningFor(id: RebindId, rebind: Record<string, string>): string | undefined {
  const w = warnings.get(id);
  return w && w.spec === currentSpec(id, rebind) ? w.text : undefined;
}

function noteFor(r: KeyRow): string {
  if (r.note) return r.note;
  return [r.where, r.page ? 'Sites can use this first' : ''].filter(Boolean).join('. ');
}

function keyText(r: KeyRow, rebind: Record<string, string>): string {
  return fillKeys(r.alt ? `${r.keys}, ${r.alt}` : r.keys, rebind);
}

function setRebind(ctx: Ctx, id: RebindId, spec: string | null): void {
  const next = { ...ctx.s().rebind };
  if (!spec || spec === REBINDABLE[id].spec) delete next[id];
  else next[id] = spec;
  ctx.set({ rebind: next });
}

function keyRow(r: KeyRow): RowDef {
  const note = noteFor(r);
  return {
    title: r.label,
    desc: note,
    keys: r.alt ? `${r.keys}, ${r.alt}` : r.keys,
    keywords: r.rebind ? `${REBINDABLE[r.rebind].label} rebind change` : undefined,
    build: (ctx) => (r.rebind ? rebindRow(ctx, r, r.rebind) : plainKeyRow(ctx, r, note)),
  };
}

function plainKeyRow(ctx: Ctx, r: KeyRow, note: string): HTMLElement {
  return row({
    title: r.label,
    desc: note || undefined,
    class: note ? '' : 'compact',
    control: () => {
      const k = h('span', { class: 'vs-key' });
      ctx.bind((s) => (k.textContent = keyText(r, s.rebind)));
      return k;
    },
  });
}

/** A row whose key can be changed: click the key text, press the new keys, Esc cancels. */
function rebindRow(ctx: Ctx, r: KeyRow, id: RebindId): HTMLElement {
  const wrap = h('div', { class: 'vs-rebind', 'data-rebind': id });
  // Each state builds its own row; only the row on screen follows the settings.
  let unbind: (() => void) | null = null;
  const showNormal = (focusKey: boolean): void => {
    unbind?.();
    const note = noteFor(r);
    let keyBtn!: HTMLButtonElement;
    let reset!: HTMLButtonElement;
    const el = row({
      title: r.label,
      desc: note,
      control: (ids) => {
        keyBtn = h('button', { type: 'button', class: 'vs-keybtn', 'aria-describedby': ids.desc });
        reset = h('button', { type: 'button', class: 'vs-link', text: 'Reset' });
        keyBtn.addEventListener('click', () => showCapture());
        reset.addEventListener('click', () => {
          warnings.delete(id);
          setRebind(ctx, id, null);
          keyBtn.focus();
        });
        return h('div', { class: 'vs-keyctl' }, reset, keyBtn);
      },
    });
    const desc = el.querySelector('.vs-desc') as HTMLElement | null;
    unbind = ctx.bind((s: Settings) => {
      const spec = displaySpec(currentSpec(id, s.rebind));
      keyBtn.textContent = spec;
      keyBtn.setAttribute('aria-label', `${r.label}: ${spec}. Change key`);
      setTip(keyBtn, 'Change key');
      reset.hidden = !s.rebind[id];
      reset.setAttribute('aria-label', `Reset ${r.label} to ${displaySpec(REBINDABLE[id].spec)}`);
      // A key another command uses too (two rebinds set to one key outside this page) is shown as
      // a conflict; otherwise the warning given when the key was set, else the usual note.
      const conflict = conflictFor(id, s.rebind);
      if (desc) {
        desc.textContent = conflict ? `Also used by ${conflict}. Choose another key.` : (warningFor(id, s.rebind) ?? note);
        desc.classList.toggle('vs-conflict', !!conflict);
      }
    });
    wrap.replaceChildren(el);
    if (focusKey) keyBtn.focus();
  };

  const showCapture = (): void => {
    capture.active?.cancel(false);
    unbind?.();
    unbind = null;
    const titleId = uid('vs-t');
    const msgId = uid('vs-m');
    const field = h('span', { class: 'vs-capfield', role: 'textbox', tabindex: '0', 'aria-labelledby': titleId, 'aria-describedby': msgId, 'data-key-capture': '' });
    const refusal = h('span', { class: 'vs-refusal', id: msgId, role: 'alert' });
    const hint = h('span', { class: 'vs-hint', text: 'Esc to cancel' });
    const el = h(
      'div',
      { class: 'vs-row vs-capture' },
      h('div', { class: 'vs-capline' }, h('span', { class: 'vs-title', id: titleId, text: r.label }), field),
      h('div', { class: 'vs-capmsg' }, refusal, hint),
    );
    const placeholder = (): void => {
      field.textContent = 'Press the new keys';
      field.classList.add('empty');
    };
    placeholder();
    let done = false;
    const finish = (focusKey: boolean): void => {
      if (done) return;
      done = true;
      capture.active = null;
      showNormal(focusKey);
    };
    capture.active = { id, cancel: (focusKey) => finish(focusKey) };

    field.addEventListener('keydown', (e) => {
      if (done) return; // the Esc ladder already cancelled this capture
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
        return;
      }
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        finish(true);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const res = readCapture(e, id, ctx.s().rebind);
      if (res.kind === 'ignore') return;
      if (res.kind === 'partial') {
        field.removeAttribute('aria-invalid');
        refusal.textContent = '';
        if (res.text) {
          field.textContent = res.text;
          field.classList.remove('empty');
        } else placeholder();
        return;
      }
      field.classList.remove('empty');
      field.textContent = displaySpec(res.spec);
      if (res.kind === 'refuse') {
        field.setAttribute('aria-invalid', 'true');
        refusal.textContent = res.reason;
        return;
      }
      if (res.warning) warnings.set(id, { spec: res.spec, text: res.warning });
      else warnings.delete(id);
      setRebind(ctx, id, res.spec);
      finish(true);
    });
    field.addEventListener('keyup', (e) => {
      // Letting go of the modifiers without a key puts the prompt back.
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && field.getAttribute('aria-invalid') !== 'true' && /\+$/.test(field.textContent ?? '')) placeholder();
    });
    field.addEventListener('focusout', (e) => {
      if (!el.contains(e.relatedTarget as Node | null)) finish(false);
    });
    wrap.replaceChildren(el);
    field.focus();
  };

  showNormal(false);
  return wrap;
}

function shiftClickRow(): RowDef {
  return {
    title: 'Shift+click a link',
    desc: 'Peek is Deer’s; Chrome opens a new window',
    keywords: 'peek new window shift click',
    build: (ctx) =>
      row({
        icon: ico.peek,
        title: 'Shift+click a link',
        desc: 'Peek is Deer’s; Chrome opens a new window',
        control: (ids) =>
          segmented(ctx, {
            labelledBy: ids.title,
            options: [
              { value: 'peek', label: 'Peek' },
              { value: 'window', label: 'Open in new window' },
            ],
            get: (s) => s.shiftClick,
            set: (v) => ctx.set({ shiftClick: v }),
          }),
      }),
  };
}

/**
 * Caret browsing (keymap.json customization: "a 'Caret browsing' switch, which has no key"). It is
 * Firefox's own pref, not a Deer setting, so the switch follows the pref (gecko.ts) instead of
 * b.settings; Deer leaves F7 to pages.
 */
function caretRow(): RowDef {
  const title = 'Caret browsing';
  const desc = 'Move through pages with a text cursor and the arrow keys';
  return {
    title,
    desc,
    keywords: 'caret cursor text arrow keys navigate f7 accessibility',
    build: (ctx) =>
      row({
        icon: ico.caret,
        title,
        desc,
        control: (ids) => {
          const sw = toggle(ctx, { labelledBy: ids.title, describedBy: ids.desc, get: () => caretBrowsing(), set: (v) => setCaretBrowsing(v) });
          const btn = sw.querySelector('.vs-switch');
          const state = sw.querySelector('.vs-state');
          ctx.cleanup(
            onCaretBrowsingChange((on) => {
              btn?.setAttribute('aria-checked', String(on));
              if (state) state.textContent = on ? 'On' : 'Off';
            }),
          );
          return sw;
        },
      }),
  };
}

function differenceRows(): RowDef[] {
  return DIFFERENT_FROM_CHROME.map((d) => ({
    title: fillKeys(d.text, {}),
    keywords: 'different from chrome',
    build: (ctx: Ctx) => {
      const text = h('span', { class: 'vs-title' });
      const el = h('div', { class: 'vs-row compact' }, h('div', { class: 'vs-text' }, text));
      if (d.link) {
        const link = d.link;
        el.append(h('button', { type: 'button', class: 'vs-link vs-go', onclick: () => ctx.go(link.section) }, link.label, iconBox(ico.chevronRight, 'vs-go-ico')));
      }
      ctx.bind((s) => {
        text.textContent = fillKeys(d.text, s.rebind);
        el.hidden = (d.when === 'shiftClickPeek' && s.shiftClick !== 'peek') || (d.when === 'mruOrder' && s.tabOrder !== 'recent');
      });
      return el;
    },
  }));
}

export const shortcutsSection: SectionDef = {
  id: 'shortcuts',
  title: 'Keyboard shortcuts',
  icon: nav.shortcuts,
  order: 80,
  intro: 'Keys never take anything Windows, an input method or a screen reader needs.',
  header: (ctx) => {
    const reset = h('button', { type: 'button', class: 'vs-btn subtle', text: 'Reset all shortcuts' });
    reset.addEventListener('click', () => {
      warnings.clear();
      ctx.set({ rebind: {} });
    });
    ctx.bind((s) => {
      const changed = Object.keys(s.rebind ?? {}).length > 0;
      reset.setAttribute('aria-disabled', String(!changed));
      reset.disabled = !changed;
    });
    return h('div', { class: 'vs-headrow' }, h('h1', { class: 'vs-h1', id: 'vs-h1', text: 'Keyboard shortcuts' }), reset);
  },
  groups: (): GroupDef[] => {
    const [peek, ...rest] = KEY_GROUPS;
    return [
      { rows: [shiftClickRow(), caretRow()] },
      { title: peek.name, rows: peek.rows.map(keyRow) },
      { title: 'Different from Chrome', rows: differenceRows() },
      ...rest.map((g) => ({ title: g.name, rows: g.rows.map(keyRow) })),
    ];
  },
};

/** For "Find a setting": does this shortcut row match the typed keys (as they are bound now)? */
export function matchesKeys(def: RowDef, query: string, rebind: Record<string, string>): boolean {
  if (!def.keys) return false;
  const q = normalizeKeys(query);
  return q.length > 1 && normalizeKeys(fillKeys(def.keys, rebind)).includes(q);
}
