import sys
def lin(c):
    c=c/255
    return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def L(h):
    h=h.lstrip('#'); r,g,b=(int(h[i:i+2],16) for i in (0,2,4))
    return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
def cr(a,b):
    la,lb=L(a),L(b)
    if la<lb: la,lb=lb,la
    return (la+0.05)/(lb+0.05)
pairs=[l.split() for l in sys.stdin if l.strip() and not l.startswith('//')]
for p in pairs:
    fg,bg,need=p[0],p[1],float(p[2]); label=' '.join(p[3:])
    v=cr(fg,bg)
    print('%-8s on %-8s %5.2f %s  %s'%(fg,bg,v,'OK ' if v>=need else 'BAD',label))
