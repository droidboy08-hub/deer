"""Write pages/test.pdf: a two-page PDF with real text ("glass" x5, "Glass" x1) for the find test."""
import os
def page_stream(lines):
    out = ["BT", "/F1 18 Tf", "72 720 Td", "24 TL"]
    for l in lines:
        out.append("(%s) Tj T*" % l)
    out.append("ET")
    return "\n".join(out).encode("latin-1")
import sys
SHORT = [
    ["Float glass - PDF probe", "Most flat glass made today is float glass.", "Molten glass is poured onto a bath of tin."],
    ["Second page", "Coated Glass is made on the same line.", "That is the last glass."],
]
LONG = [["Page %d of 40" % (i + 1), "One glass on every page, so 40 in the document."] + ["Filler line %d." % j for j in range(20)] for i in range(40)]
name = sys.argv[1] if len(sys.argv) > 1 else "test.pdf"
pages = LONG if "long" in name else SHORT
objs = []
def add(b):
    objs.append(b)
    return len(objs)
font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
kids = []
pages_id_placeholder = len(objs) + 1 + 2 * len(pages)  # pages object comes after all page+content objects
for lines in pages:
    s = page_stream(lines)
    c = add(b"<< /Length %d >>\nstream\n" % len(s) + s + b"\nendstream")
    p = add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>" % (pages_id_placeholder, c, font))
    kids.append(p)
pages_id = add(b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids)))
assert pages_id == pages_id_placeholder
cat = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)
out = bytearray(b"%PDF-1.4\n")
offs = []
for i, o in enumerate(objs, 1):
    offs.append(len(out))
    out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
xref = len(out)
out += b"xref\n0 %d\n" % (len(objs) + 1) + b"0000000000 65535 f \n"
for o in offs:
    out += b"%010d 00000 n \n" % o
out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, cat, xref)
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pages", name)
open(path, "wb").write(out)
print(path, len(out))
