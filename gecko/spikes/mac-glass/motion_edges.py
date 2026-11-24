# S6 helper (spikes/mac-glass): reads a recorder.py video (2400x840 px crop of the window from (100,150) pt). Python 3.9 + ffmpeg.
import subprocess, sys
vid = sys.argv[1]; frames = [int(x) for x in sys.argv[2].split(',')]
W,H=2400,840
sel = '+'.join('eq(n\\,%d)'%f for f in frames)
buf = subprocess.run(['ffmpeg','-v','error','-i',vid,'-vf',"select='%s'"%sel,'-fps_mode','passthrough','-pix_fmt','gray','-f','rawvideo','-'],capture_output=True).stdout
for k,fn in enumerate(frames):
    f = buf[k*W*H:(k+1)*W*H]
    # left edge: row y=600 px (inside A, below band -> white page around), scan from x=40 right
    y=600
    left = next((x for x in range(40,200) if f[y*W+x] < 150), -1)
    right = max([x for x in range(500,760) if f[y*W+x] < 150] or [-1])
    # top edge: column x=380, scan y from 60 down; band (colours) is behind top part, so use the glass's
    # change: page above A at y<100 is white (page y<150 -> region y<110pt=220px?)
    x=380
    top = next((yy for yy in range(60,300) if f[yy*W+x] < 200), -1)
    bottom = max([yy for yy in range(560,800) if f[yy*W+x] < 150] or [-1])
    print(fn, 'left',left,'right',right,'top',top,'bottom',bottom, 'w',right-left+1,'h',bottom-top+1)
