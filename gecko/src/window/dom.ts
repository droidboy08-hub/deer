// DOM helpers for Deer's layer inside browser.xhtml.
//
// browser.xhtml is an XHTML document with a XUL body: document.createElement gives HTML elements,
// innerHTML is sanitized (scripts and handlers dropped) and inline scripts are blocked by the CSP.
// Build UI with these helpers. Never put page-derived strings through svg() or any markup parser:
// use textContent / setAttribute for those.

type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Create an HTML element: el('button', { class: 'nav', 'aria-label': 'Back' }, child, 'text'). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

const parser = new DOMParser();

/**
 * An <svg> element from trusted, static markup (icons). The markup must be well-formed XML; the
 * xmlns is added when missing. Throws on a parse error so a broken icon is found at once.
 */
export function svg(markup: string): SVGSVGElement {
  const text = markup.includes('xmlns=') ? markup : markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const parsed = parser.parseFromString(text, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg') throw new Error('svg(): not well-formed: ' + markup.slice(0, 60));
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

/** Replace an element's children. */
export function fill(node: Element, ...children: (Node | string)[]): void {
  node.replaceChildren(...children);
}
