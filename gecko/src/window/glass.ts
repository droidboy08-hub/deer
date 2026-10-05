// Liquid glass on Gecko: the lens filters behind `.glass > .lens`.
//
// Electron bends the page with feImage + feDisplacementMap (app/src/renderer/glass.ts). WebRender in
// Firefox 157 runs neither in a backdrop-filter, so the bezel refraction is approximated with a
// "strip lens": a few feOffset strips with primitive subregions (top and bottom bend the backdrop
// vertically, the caps bend it horizontally), merged over the plain backdrop, then blurred and
// saturated exactly like the Electron lens. Same parameters as Electron: bezel min(14, h/3),
// scale 18 (12 when h <= 36), blur 1.4 (2.4 on the active pill), saturate 1.5, falloff (1-t)^2.2.
// Recipe and limits: spikes/glass/RESULT.md (glasslib.js stripLensMarkup / rowLensMarkup and the
// verifier's v4-parent.js, v6-row.js).
//
// Why it works at all: #tabbrowser-tabbox carries filter: saturate(1.0001) (skin/shell.css 3), which
// makes it the backdrop root for the page and for #vitre-root, so backdrop-filter in Deer's layer
// samples the live page. Anything with opacity < 1, a filter, a mask or a clip-path between
// #vitre-root and a lens element becomes a new backdrop root and the lens then sees nothing: keep
// such effects off the ancestors of glass (transforms are fine).
//
// API for the core and for feature modules:
//   glass(el)                 make `el` a glass element: adds class "glass" and the three layers
//                             (.lens, .tint, .rim) as its first children; returns { lens, tint, rim }.
//                             Position, size, radius come from your CSS (skin/glass.css gives
//                             position: absolute, radius 22, the theme's shadow, tint and rim).
//   lens(w, h, opts)          a backdrop-filter value for one shape of this size, e.g.
//                             layers.lens.style.backdropFilter = lens(480, 44, { blur: 2.4 }).
//                             One SVG filter per distinct size, created on first use. The last
//                             MAX_LENSES sizes are kept; older filters that no element's style
//                             references any more are removed (an element keeps the filter it uses).
//                             Set it again when the element's size changes; while the size animates
//                             use MORPH (class "morphing" on the .glass element does that).
//                             opts.opaque: for a large blur (panels, popovers). The blur mixes the
//                             backdrop near the element's edges with the transparent black outside
//                             the filter region, and WebRender draws the backdrop-filter output OVER
//                             the unfiltered backdrop, so the sharp page shows through a band as
//                             wide as the blur along every edge. opaque adds one feComponentTransfer
//                             that sets alpha to 1 after the blur (the colours are already the
//                             average of the pixels inside). Verified by tests/settings (Settings'
//                             960x688 sheet, blur 22).
//   rowLens(width, h, shapes) ONE filter for a row of same-height capsules (the tab bar's circles):
//                             returns { filter, clip, nodes, release }. Put filter on a single
//                             element spanning the row and clip it with clip-path = clip. The top
//                             and bottom strips are shared, so a row costs 6 + 4 per shape feOffset
//                             nodes instead of 12 per shape. Call release() when the row is replaced.
//   FROST                     'blur(24px) saturate(1.6)': panels, menus, popovers (class "frost"
//                             on the .glass element does the same).
//   MORPH                     'blur(10px) saturate(1.6)': while a glass element changes size.
//   PLAIN                     'blur(1.4px) saturate(1.5)': the lens without refraction, for a
//                             shape that is moving (a filter cannot follow an animated position
//                             inside a shared row).
//   MAX_ROW_SHAPES            how many shapes one rowLens() call may hold (see below).
//
// Limits (fail silently: the element shows the raw backdrop):
//   - gfx.webrender.max-filter-ops-per-chain primitives per filter (Deer ships 256, stock is 64);
//   - a hard cap of about 122 feOffset nodes per filter whatever the pref. A row of 29 shapes sits
//     exactly on it, so rows are chunked at MAX_ROW_SHAPES = 24 (102 nodes).
//   - Never write url("...") or path("...") into a style attribute; set styles through the CSSOM.
//   - A filter inside a display: none subtree does not resolve: the <svg> holding the filters is
//     zero-sized, not hidden. (In DOM full screen #vitre-root is display: none; nothing is drawn then.)
import { el } from './dom';

const SVGNS = 'http://www.w3.org/2000/svg';

export const FROST = 'blur(24px) saturate(1.6)';
export const MORPH = 'blur(10px) saturate(1.6)';
export const PLAIN = 'blur(1.4px) saturate(1.5)';
export const MAX_ROW_SHAPES = 24;
/** Distinct lens sizes kept; beyond that the least recently asked-for, unreferenced filters go. */
export const MAX_LENSES = 16;

export interface LensOptions {
  /** Corner radius; default is a capsule (half the smaller side). */
  radius?: number;
  bezel?: number;
  scale?: number;
  blur?: number;
  saturate?: number;
  /** Force alpha to 1 after the blur, so a large blur never lets the sharp page through at the edges (see the header). */
  opaque?: boolean;
}

export interface GlassLayers {
  lens: HTMLElement;
  tint: HTMLElement;
  rim: HTMLElement;
}

export interface RowLens {
  /** backdrop-filter value for the row element. */
  filter: string;
  /** clip-path value: the union of the shapes. */
  clip: string;
  /** feOffset nodes in the filter. */
  nodes: number;
  /** Remove the filter (when the row is rebuilt). */
  release(): void;
}

/** Depth bands across the bezel, in px for a 14 px bezel (scaled with the bezel). */
const BANDS: [number, number][] = [[0, 2.5], [2.5, 5.5], [5.5, 9.5]];
/** Coarser bands for the caps of a shared row filter. */
const ROW_CAP_BANDS: [number, number][] = [[0, 3], [3, 8]];

const cache = new Map<string, string>();
let serial = 0;

function defs(): SVGDefsElement {
  let svg = document.getElementById('vitre-glass-defs') as unknown as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS(SVGNS, 'svg') as SVGSVGElement;
    svg.id = 'vitre-glass-defs';
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';
    svg.append(document.createElementNS(SVGNS, 'defs'));
    (document.getElementById('vitre-root') ?? document.documentElement).append(svg);
  }
  return svg.firstChild as SVGDefsElement;
}

function node(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const e = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.append(e);
  return e;
}

const r2 = (v: number): number => +v.toFixed(2);

/** Mean of the lens profile (1 - d/bezel)^2.2 over the depth band [a, b], as an offset in px. */
function magnitude(a: number, b: number, bezel: number, scale: number): number {
  let sum = 0;
  const n = 8;
  for (let i = 0; i < n; i++) sum += Math.pow(1 - Math.min(1, (a + ((b - a) * (i + 0.5)) / n) / bezel), 2.2);
  return r2(((sum / n) * scale) / 2);
}

/**
 * Builds <filter> with the strips, the merge, blur and saturation. `strips` are feOffset regions:
 * the output at p is the backdrop at p - (dx, dy), so a strip that samples from further inside the
 * shape has its offset pointing outwards.
 */
function build(id: string, w: number, h: number, strips: { x: number; y: number; w: number; h: number; dx: number; dy: number }[], blur: number, saturate: number, opaque = false): SVGElement {
  const f = node('filter', { id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }, defs());
  const live = strips.filter((s) => s.w > 0 && s.h > 0);
  live.forEach((s, i) => node('feOffset', { in: 'SourceGraphic', dx: r2(s.dx), dy: r2(s.dy), x: r2(s.x), y: r2(s.y), width: r2(s.w), height: r2(s.h), result: `s${i}` }, f));
  const merge = node('feMerge', { x: 0, y: 0, width: w, height: h, result: 'bent' }, f);
  node('feMergeNode', { in: 'SourceGraphic' }, merge);
  live.forEach((_, i) => node('feMergeNode', { in: `s${i}` }, merge));
  node('feGaussianBlur', { in: 'bent', stdDeviation: blur, result: 'soft' }, f);
  node('feColorMatrix', { in: 'soft', type: 'saturate', values: saturate }, f);
  if (opaque) node('feFuncA', { type: 'discrete', tableValues: '1 1' }, node('feComponentTransfer', {}, f));
  f.setAttribute('data-nodes', String(live.length));
  return f;
}

/** A backdrop-filter value for a lens of this size, creating the filter on first use (12 feOffset nodes). */
export function lens(w: number, h: number, opts: LensOptions = {}): string {
  w = Math.round(w);
  h = Math.round(h);
  const radius = opts.radius ?? Math.min(w, h) / 2;
  const bezel = opts.bezel ?? Math.min(14, h / 3);
  const scale = opts.scale ?? (h <= 36 ? 12 : 18);
  const blur = opts.blur ?? 1.4;
  const saturate = opts.saturate ?? 1.5;
  const key = `${w}x${h}r${radius}b${bezel}s${scale}u${blur}a${saturate}${opts.opaque ? 'o' : ''}`;
  const hit = cache.get(key);
  if (hit) {
    // Most recently asked for goes last (the Map keeps insertion order).
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const f = bezel / 14;
  const strips: Parameters<typeof build>[3] = [];
  for (const [a0, b0] of BANDS) {
    const a = a0 * f;
    const b = b0 * f;
    const m = magnitude(a, b, bezel, scale);
    strips.push({ x: 0, y: a, w, h: b - a, dx: 0, dy: -m }); // top edge: sample from below
    strips.push({ x: 0, y: h - b, w, h: b - a, dx: 0, dy: m }); // bottom edge: sample from above
  }
  if (radius > 4) {
    // Caps: only where the outline is closer to vertical than horizontal.
    const inset = radius * (1 - Math.SQRT1_2);
    for (const [a0, b0] of BANDS) {
      const a = a0 * f;
      const b = b0 * f;
      const m = magnitude(a, b, bezel, scale);
      strips.push({ x: a, y: inset, w: b - a, h: h - 2 * inset, dx: -m, dy: 0 });
      strips.push({ x: w - b, y: inset, w: b - a, h: h - 2 * inset, dx: m, dy: 0 });
    }
  }
  const id = `vitre-lens-${serial++}`;
  build(id, w, h, strips, blur, saturate, !!opts.opaque);
  const value = `url(#${id})`;
  cache.set(key, value);
  trimLenses();
  return value;
}

/**
 * Keep the cache at MAX_LENSES: the oldest entries go first, but a filter some element still names
 * in its style stays (the address field at many widths must not take the pill's lens away).
 */
function trimLenses(): void {
  if (cache.size <= MAX_LENSES) return;
  for (const [key, value] of cache) {
    if (cache.size <= MAX_LENSES) break;
    const id = value.slice(5, -1); // url(#id)
    // Styles set through the CSSOM serialize as backdrop-filter: url("#id") in the style attribute.
    if (document.querySelector(`[style*='url("#${id}")']`)) continue;
    cache.delete(key);
    document.getElementById(id)?.remove();
  }
}

/** Filters that exist right now, for tests: `b.bar.state.lenses`. */
export function lensCount(): { filters: number; rows: number; cached: number } {
  const all = Array.from(document.querySelectorAll('#vitre-glass-defs filter'));
  return { filters: all.length, rows: all.filter((f) => f.id.startsWith('vitre-row-')).length, cached: cache.size };
}

/**
 * One lens for a row of capsules of height `h` (radius h/2). `shapes` are { x, w } relative to the
 * row element, at most MAX_ROW_SHAPES of them. The row element must be `width` x `h`.
 */
export function rowLens(width: number, h: number, shapes: { x: number; w: number }[], opts: LensOptions = {}): RowLens {
  if (shapes.length > MAX_ROW_SHAPES) throw new Error(`rowLens: ${shapes.length} shapes, the limit is ${MAX_ROW_SHAPES}`);
  width = Math.ceil(width);
  const bezel = opts.bezel ?? Math.min(14, h / 3);
  const scale = opts.scale ?? (h <= 36 ? 12 : 18);
  const blur = opts.blur ?? 1.4;
  const saturate = opts.saturate ?? 1.5;
  const f = bezel / 14;
  const radius = h / 2;
  const inset = radius * (1 - Math.SQRT1_2);
  const strips: Parameters<typeof build>[3] = [];
  for (const [a0, b0] of BANDS) {
    const a = a0 * f;
    const b = b0 * f;
    const m = magnitude(a, b, bezel, scale);
    strips.push({ x: 0, y: a, w: width, h: b - a, dx: 0, dy: -m });
    strips.push({ x: 0, y: h - b, w: width, h: b - a, dx: 0, dy: m });
  }
  let path = '';
  for (const s of shapes) {
    for (const [a0, b0] of ROW_CAP_BANDS) {
      const a = a0 * f;
      const b = b0 * f;
      const m = magnitude(a, b, bezel, scale);
      strips.push({ x: s.x + a, y: inset, w: b - a, h: h - 2 * inset, dx: -m, dy: 0 });
      strips.push({ x: s.x + s.w - b, y: inset, w: b - a, h: h - 2 * inset, dx: m, dy: 0 });
    }
    const x0 = r2(s.x + radius);
    const x1 = r2(s.x + s.w - radius);
    path += `M${x0},0 H${x1} A${radius},${radius} 0 0 1 ${x1},${h} H${x0} A${radius},${radius} 0 0 1 ${x0},0 Z `;
  }
  const id = `vitre-row-${serial++}`;
  const filter = build(id, width, h, strips, blur, saturate);
  return {
    filter: `url(#${id})`,
    clip: `path('${path.trim()}')`,
    nodes: strips.length,
    release: () => filter.remove(),
  };
}

/** The three layers of a glass element, in paint order. */
export function glassLayers(): GlassLayers {
  return { lens: el('div', { class: 'lens' }), tint: el('div', { class: 'tint' }), rim: el('div', { class: 'rim' }) };
}

/** Make `host` a glass element (class "glass", layers as its first children). */
export function glass(host: HTMLElement): GlassLayers {
  const layers = glassLayers();
  host.classList.add('glass');
  host.prepend(layers.lens, layers.tint, layers.rim);
  return layers;
}
