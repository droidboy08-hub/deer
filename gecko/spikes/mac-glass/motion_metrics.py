# S6 helper (spikes/mac-glass): reads a recorder.py video (2400x840 px crop of the window from (100,150) pt). Python 3.9 + ffmpeg.
import subprocess, sys, re
vid, times = sys.argv[1], sys.argv[2]
W, H = 1200, 420
ts = [float(l.split('pts_time:')[1]) for l in open(times)]
p = subprocess.Popen(['ffmpeg','-v','error','-i',vid,'-vf','scale=%d:%d'%(W,H),'-fps_mode','passthrough','-pix_fmt','gray','-f','rawvideo','-'],stdout=subprocess.PIPE)
def mean(f, x, y, w, h, step=2):
    s=n=0
    for yy in range(y, y+h, step):
        row = yy*W
        for xx in range(x, x+w, step):
            s += f[row+xx]; n += 1
    return s/n
def left_edge(f, y, x0, x1, bg):
    # first x where pixel differs from bg by > 25
    for xx in range(x0, x1):
        if abs(f[y*W+xx]-bg) > 25: return xx
    return -1
def top_edge(f, x, y0, y1, bg):
    for yy in range(y0, y1):
        if abs(f[yy*W+x]-bg) > 25: return yy
    return -1
i=0
print('i t A_mean A_left A_top A_right shadowA B_mean C_mean shadowC')
while True:
    buf = p.stdout.read(W*H)
    if len(buf) < W*H: break
    f = buf
    t = ts[i] if i < len(ts) else -1
    A = mean(f, 60, 70, 260, 260)
    # A spans x 40..340, y 50..350 (points). Its left edge on a row in the white part? rows y 50..150 are over the stripe band (150..350 page => region y 110..310). white above band: page y<150 -> region y < 110.
    al = left_edge(f, 80, 20, 120, f[80*W+10])      # row y=80 (white page behind), from x 20
    at = top_edge(f, 190, 20, 90, f[20*W+190])        # column x=190, from y 20
    ar = -1
    for xx in range(380, 300, -1):
        if abs(f[80*W+xx]-f[80*W+390]) > 25: ar = xx; break
    shA = mean(f, 60, 356, 260, 16)                    # just below A: white page
    B = mean(f, 425, 55, 160, 26)
    C = mean(f, 820, 70, 260, 260)
    shC = mean(f, 820, 356, 260, 16)
    print(i, '%.3f'%t, round(A,1), al, at, ar, round(shA,1), round(B,1), round(C,1), round(shC,1))
    i+=1
