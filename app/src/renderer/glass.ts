// Liquid glass: edge-lens displacement maps generated at runtime, one SVG filter per size.
// Clear in the middle; the page bends only across the bezel, as on the design canvas.

const SVGNS = 'http://www.w3.org/2000/svg';
const cache = new Map<string, string>();

function lensMap(w: number, h: number, r: number, bezel: number, power: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - (w / 2 - r);
      const qy = Math.abs(py) - (h / 2 - r);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - r; // < 0 inside
      const t = Math.min(1, Math.max(0, -d / bezel));
      const k = Math.pow(1 - t, power);
      let nx = 0;
      let ny = 0;
      if (qx > 0 || qy > 0) {
        const l = Math.hypot(ox, oy) || 1;
        nx = (Math.sign(px) * ox) / l;
        ny = (Math.sign(py) * oy) / l;
      } else if (qx > qy) nx = Math.sign(px);
      else ny = Math.sign(py);
      const i = (y * w + x) * 4;
      img.data[i] = Math.round(128 - nx * k * 127);
      img.data[i + 1] = Math.round(128 - ny * k * 127);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** Returns a CSS backdrop-filter value for a lens of this size, creating the filter on first use. */
export function lens(w: number, h: number, opts: { radius?: number; bezel?: number; scale?: number; blur?: number } = {}): string {
  w = Math.round(w);
  h = Math.round(h);
  const radius = opts.radius ?? Math.min(w, h) / 2;
  const bezel = opts.bezel ?? Math.min(14, h / 3);
  const scale = opts.scale ?? (h <= 36 ? 12 : 18);
  const blur = opts.blur ?? 1.4;
  const key = `${w}x${h}r${radius}b${bezel}s${scale}u${blur}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const id = `lens-${cache.size}`;
  const defs = document.querySelector('#glass-defs defs') as SVGDefsElement;
  const f = document.createElementNS(SVGNS, 'filter');
  f.setAttribute('id', id);
  for (const [k, v] of Object.entries({ x: '0', y: '0', width: String(w), height: String(h), filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
  const img = document.createElementNS(SVGNS, 'feImage');
  for (const [k, v] of Object.entries({ x: '0', y: '0', width: String(w), height: String(h), preserveAspectRatio: 'none', result: 'map' })) img.setAttribute(k, v);
  img.setAttribute('href', lensMap(w, h, radius, bezel, 2.2));
  const soft = document.createElementNS(SVGNS, 'feGaussianBlur');
  soft.setAttribute('in', 'SourceGraphic');
  soft.setAttribute('stdDeviation', String(blur));
  soft.setAttribute('result', 'soft');
  const disp = document.createElementNS(SVGNS, 'feDisplacementMap');
  for (const [k, v] of Object.entries({ in: 'soft', in2: 'map', scale: String(scale), xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' })) disp.setAttribute(k, v);
  const sat = document.createElementNS(SVGNS, 'feColorMatrix');
  sat.setAttribute('in', 'bent');
  sat.setAttribute('type', 'saturate');
  sat.setAttribute('values', '1.5');
  f.append(img, soft, disp, sat);
  defs.append(f);
  const value = `url(#${id})`;
  cache.set(key, value);
  return value;
}

/** Glass element skeleton: lens, tint and rim layers under the content. */
export function glassLayers(): string {
  return '<div class="lens"></div><div class="tint"></div><div class="rim"></div>';
}
