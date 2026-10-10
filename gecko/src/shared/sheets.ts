// Has a document got its style sheets yet? Content-side helper (page modules).
//
// Until a <link rel=stylesheet> has its sheet, Gecko holds the page's first layout back, so nothing
// unstyled is drawn. Anything that makes the page lay out before that (reading a box, a scroll
// position, the padding through getComputedStyle, or the window's drawSnapshot of it) lays out the
// unstyled page, which can then be painted: a flash of unstyled content, and Firefox's warning
// "Layout was forced before the page was fully loaded".

/** A <link rel=stylesheet> of the document is still loading. */
export function sheetsPending(doc: Document): boolean {
  try {
    for (const link of doc.querySelectorAll('link[rel~="stylesheet" i]')) {
      if (!(link as HTMLLinkElement).sheet && !(link as HTMLLinkElement).disabled) return true;
    }
  } catch {
    return true;
  }
  return false;
}
