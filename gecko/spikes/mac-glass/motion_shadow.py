# S6 helper (spikes/mac-glass): reads a recorder.py video (2400x840 px crop of the window from (100,150) pt). Python 3.9 + ffmpeg.
import subprocess, sys
vid = sys.argv[1]; frames = [int(x) for x in sys.argv[2].split(',')]
W,H=2400,840
sel = '+'.join('eq(n\\,%d)'%f for f in frames)
p = subprocess.run(['ffmpeg','-v','error','-i',vid,'-vf',"select='%s'"%sel,'-fps_mode','passthrough','-pix_fmt','gray','-f','rawvideo','-'],capture_output=True)
buf=p.stdout
for k,fn in enumerate(frames):
    f = buf[k*W*H:(k+1)*W*H]
    x = 380  # px, centre of A (190 pt)
    # find bottom edge: scanning down from y=600px (300pt) to 800px: last px where value < 200 (dark glass)
    col = [f[y*W+x] for y in range(560, 800)]
    edge = max([i for i,v in enumerate(col) if v < 150] or [-1]) + 560
    below = [f[(edge+d)*W+x] for d in (2,6,10,16,24,32,44)] if edge>0 else []
    # also the right edge shadow: row at y=400px (200pt) scanning right from x=640 (A right=680px)
    row = [f[400*W+xx] for xx in range(600, 760)]
    redge = max([i for i,v in enumerate(row) if v < 150] or [-1]) + 600
    right = [f[400*W+redge+d] for d in (2,6,10,16,24)] if redge>600 else []
    print('frame', fn, 'bottom edge y', edge, 'below', below, '| right edge x', redge, 'right of it', right)
