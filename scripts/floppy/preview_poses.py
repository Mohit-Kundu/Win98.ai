"""Quick look at a handful of poses (development aid)."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image

from character import REST, render_frame

poses = [
    {},
    dict(es='happy', mouth='open', mo=0.7, bl=4, br=4, lh=(-46, -50), rh=(46, -50), lhs='open', rhs='open', dy=-6),
    dict(es='wide', mouth='o', mo=0.4, bl=6, br=6, tl=1.5, tr=1.5, fx='excl', ft=1, rot=3),
    dict(lx=0.8, ly=-0.8, mouth='smirk', rh=(24, -34), prop=None, fx='think', ft=0.7, bl=3, tr=-1.5),
    dict(prop='pencil', rh=(10, -14), rhs='grip', ly=0.8, lx=0.4, mouth='flat'),
    dict(prop='magnifier', rh=(34, -26), rhs='grip', lx=0.7, bl=2, tr=-1.2, mouth='o', mo=0.1),
    dict(hat='wizard', prop='wand', rh=(42, -36), rhs='grip', pq=40, pp=1, es='happy', mouth='open', mo=0.5, fx='sparkle', ft=0.3),
    dict(hat='beret', prop='brush', rh=(40, -30), rhs='grip', mouth='smile', fx='paint', ft=0.8),
    dict(shut=1, lab=0.6, es='closed', mouth='flat', fx='check', ft=1),
    dict(prop='keys', lh=(-14, -10), rh=(14, -10), lhs='fist', rhs='fist', ly=0.8, fx='binary', ft=0.4, mouth='flat'),
    dict(prop='clip', lh=(-38, -26), lhs='grip', pp=2, pq=-8, lx=-0.7, ly=0.5),
    dict(es='closed', rot=4, fx='zzz', ft=0.4, mouth='o', mo=0.3),
]
sheet = Image.new('RGBA', (120 * 6, 128 * 2), (0, 128, 128, 255))
for i, o in enumerate(poses):
    p = dict(REST)
    p.update(o)
    sheet.alpha_composite(render_frame(p), ((i % 6) * 120, (i // 6) * 128))
sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
out = sys.argv[1] if len(sys.argv) > 1 else 'poses.png'
sheet.save(out)
print('saved', out)

