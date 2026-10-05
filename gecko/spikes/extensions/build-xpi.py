"""Build the install-flow test packages from ext/inst:

  www/vitre-install.xpi  an unsigned XPI (a plain ZIP)
  www/vitre-install.crx  the same ZIP behind a CRX3-style "Cr24" header, standing in for a
                         Chrome Web Store package
"""
import os
import struct
import zipfile

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, 'ext', 'inst')
out = os.path.join(here, 'www', 'vitre-install.xpi')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir(src)):
        z.write(os.path.join(src, name), name)
print('wrote', out, os.path.getsize(out), 'bytes')

crx = os.path.join(here, 'www', 'vitre-install.crx')
with open(out, 'rb') as f:
    data = f.read()
with open(crx, 'wb') as f:
    f.write(b'Cr24' + struct.pack('<II', 3, 16) + bytes(16) + data)
print('wrote', crx, os.path.getsize(crx), 'bytes')
