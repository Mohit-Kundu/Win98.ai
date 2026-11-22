"""Floppy: a 3.5-inch disk character rendered in a late-90s 3D style (bevels, chrome, ambient occlusion).

Every facial feature is a real part of the disk, shown with the shutter edge at the bottom:
  mouth     the slot in the metal shutter (it widens when talking, the shutter plate slides when saving)
  eyes      the two square corner holes; the write-protect slider tabs are the pupils
  eyelids   plastic covers that slide over the holes (blink, squint, smile)
  brows     molded ridges in the plastic above the holes
  forehead  the paper label (ruled lines, or a progress bar while saving)
  corner    the chamfered insertion notch, bottom left
"""
import math
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw

from engine import OX, OY, SS, W, H, Layer, erode, finish, qb, rgba, rot, rpoly, shift, soft_shadow, transform

# ---------------------------------------------------------------- pose

REST = dict(
    dx=0, dy=0, rot=0, sx=1, sy=1, alpha=1, flash=0,
    lx=0, ly=0, ol=1, orr=1, es='n', esc=1,       # eyes: slider look, open amount, style, scale
    bl=0, br=0, tl=0, tr=0,                       # brows: raise (px) and tilt (px, + = worried)
    mouth='smile', mo=0, mcur=1,                  # mouth slot: kind, openness 0..1
    shut=0, scr=1, lab=-1,                        # shutter slide 0..1, label text 0..1, progress bar (-1 = off)
    lh=(-40, -6), rh=(40, -6), lhs='open', rhs='open', lbend=3, rbend=3, lha=0, rha=0,  # hand anchors for props
    prop=None, pp=0, pq=0, hat=None, sheet=0, cheek=1,
    fx=None, ft=0, fx2=None, ft2=0,
)

INK = (22, 26, 36)
CLEAR = (0, 0, 0, 0)


def ink(a=255):
    return (*INK, a)


def mul(c, k):
    return (min(255, int(c[0] * k)), min(255, int(c[1] * k)), min(255, int(c[2] * k)), c[3] if len(c) > 3 else 255)


def lighten(c, k):
    return (int(c[0] + (255 - c[0]) * k), int(c[1] + (255 - c[1]) * k), int(c[2] + (255 - c[2]) * k), c[3] if len(c) > 3 else 255)


def cyl(c):
    """Gradient stops that make a flat colour read as a cylinder (across its width)."""
    return [(0, mul(c, 0.42)), (0.28, mul(c, 0.9)), (0.45, lighten(c, 0.55)), (0.7, mul(c, 0.8)), (1, mul(c, 0.4))]


BODY = [(-33, -70), (24, -70), (33, -61), (33, 0), (-33, 0)]  # chamfer is the disk's corner notch
BODY_PTS = rpoly(BODY, [5, 2.4, 2.4, 4, 4])
PLASTIC = ('ls', [(0, (240, 242, 246, 255)), (0.35, (212, 216, 224, 255)), (1, (146, 152, 164, 255))], (-33, -70), (33, 0))
CHROME = [(0, (252, 253, 255, 255)), (0.2, (216, 221, 231, 255)), (0.44, (150, 158, 174, 255)), (0.5, (108, 116, 132, 255)),
          (0.57, (176, 184, 198, 255)), (0.82, (238, 241, 247, 255)), (1, (166, 174, 190, 255))]


def bevel(L, mask, d=1.6, light=(255, 255, 255, 200), dark=(8, 12, 22, 150), blur=0.4, clip=None):
    clip = mask if clip is None else clip
    L.soft(ImageChops.subtract(mask, shift(mask, d, d)), light, blur, clip=clip)
    L.soft(ImageChops.subtract(mask, shift(mask, -d, -d)), dark, blur, clip=clip)


def sphere(L, x, y, r, hi, lo, rim=170):
    mid = tuple(int((a + b) / 2) for a, b in zip(hi, lo))
    L.ellipse(x, y, r, r, fill=('rs', [(0, hi), (0.55, mid), (1, lo)], (x - 0.32 * r, y - 0.36 * r), 1.3 * r, 1.3 * r), line=ink(rim), lw=0.8)
    L.ellipse(x - 0.34 * r, y - 0.42 * r, 0.36 * r, 0.22 * r, fill=(255, 255, 255, 210))


def star4(L, x, y, r, color, spin=0):
    pts = []
    for i in range(8):
        rr = r if i % 2 == 0 else r * 0.3
        a = math.radians(i * 45 + spin - 90)
        pts.append((x + rr * math.cos(a), y + rr * math.sin(a)))
    L.poly(pts, fill=color)


def glint(L, x, y, r, spin=0, color=(255, 255, 255, 255)):
    L.soft(L.ellipse_mask(x, y, r * 0.7, r * 0.7), (255, 255, 255, 140), r * 0.45)
    star4(L, x, y, r, color, spin)


# ---------------------------------------------------------------- face and body parts

_TEX = None


def brushed():
    """Horizontal brushed-metal streaks, generated once."""
    global _TEX
    if _TEX is None:
        rng = np.random.default_rng(7)
        small = (rng.random((H * SS // 2, 26)) * 255).astype('uint8')
        _TEX = Image.fromarray(small, 'L').resize((W * SS, H * SS), Image.BICUBIC)
    return _TEX


ER_X, ER_Y, EYE_Y = 9.6, 8.6, -38.2


def eyeball(L, body, cx, side, openv, style, lx, ly, sc, tilt):
    """A big glossy googly eye sitting on the disk."""
    sc = sc * (1.1 if style == 'wide' else 1.0)
    rx, ry, cy = ER_X * sc, ER_Y * sc, EYE_Y
    if style == 'closed' or openv < 0.15:  # closed eye: a curved line, like a drawn lid
        arc = qb((cx - rx * 0.8, cy - 0.5), (cx, cy + 5.0), (cx + rx * 0.8, cy - 0.5), 12)
        L.stroke([(x, y + 1.2) for x, y in arc], (255, 255, 255, 110), 1.0, clip=None)
        L.stroke(arc, (28, 32, 44, 255), 2.3)
        return
    ball = L.ellipse_mask(cx, cy, rx, ry)
    L.soft(ball, (4, 6, 12, 160), 1.0, clip=body, off=(0.9, 1.8))
    L.ellipse(cx, cy, rx, ry, fill=('rs', [(0, (255, 255, 255, 255)), (0.55, (243, 245, 249, 255)), (1, (170, 178, 194, 255))],
                                   (cx - 2.2, cy - 2.6), rx * 1.15, ry * 1.15), line=(64, 70, 86, 235), lw=0.8)
    pr = 4.3 if style == 'wide' else 5.2
    px = cx + lx * (rx - pr - 0.9)
    py = cy + ly * (ry - pr - 0.9)
    L.ellipse(px, py, pr, pr * 1.02, fill=('rs', [(0, (74, 78, 94, 255)), (0.5, (14, 15, 20, 255)), (1, (2, 2, 4, 255))], (px - 1.5, py - 1.8), pr * 1.2, pr * 1.2), clip=ball)
    L.ellipse(px - 1.7, py - 2.0, 1.55, 1.35, fill=(255, 255, 255, 240), clip=ball)
    L.ellipse(px + 1.9, py + 2.2, 0.7, 0.6, fill=(255, 255, 255, 120), clip=ball)
    L.soft(ImageChops.subtract(ball, shift(ball, -1.5, -1.7)), (10, 14, 24, 120), 0.9, clip=ball)

    top, bottom = 1 - openv, 0.0
    if style == 'happy':
        top, bottom = 0.08, 0.5
    elif style == 'closed':
        top = 0.97
    top = max(0.0, min(0.97, top))
    slant = 0 if top > 0.8 else tilt * 1.4
    xl, xr = cx - rx - 1, cx + rx + 1
    if top > 0.02:
        yy = cy - ry + top * 2 * ry
        yin, yout = yy - slant, yy + slant
        yl, yr = (yout, yin) if side < 0 else (yin, yout)
        lid = L.poly_mask([(xl, cy - ry - 4), (xr, cy - ry - 4)] + qb((xr, yr), (cx, (yl + yr) / 2 + 2.6), (xl, yl), 10))
        L.soft(lid, (6, 8, 14, 170), 0.7, clip=ball, off=(0, 1.5))
        L._paint(lid, PLASTIC, clip=ball)
        edge = qb((xr, yr), (cx, (yl + yr) / 2 + 2.6), (xl, yl), 10)
        L.stroke(edge, (30, 36, 50, 220), 0.9, clip=ball, caps=False)
        L.stroke([(x, y - 0.9) for x, y in edge], (255, 255, 255, 120), 0.6, clip=ball, caps=False)
    if bottom > 0.02:
        yb = cy + ry - bottom * 2 * ry
        arc = qb((xl, yb + 1.5), (cx, yb - 4.5), (xr, yb + 1.5), 10)
        lid = L.poly_mask(arc + [(xr, cy + ry + 4), (xl, cy + ry + 4)])
        L.soft(lid, (6, 8, 14, 150), 0.7, clip=ball, off=(0, -1.0))
        L._paint(lid, PLASTIC, clip=ball)
        L.stroke(arc, (30, 36, 50, 220), 0.9, clip=ball, caps=False)
        L.stroke([(x, y + 0.9) for x, y in arc], (255, 255, 255, 110), 0.6, clip=ball, caps=False)


def brow(L, body, cx, side, raise_, tilt):
    """Curved rubbery brow arc above the eye."""
    inward = -side
    y = -51.0 - raise_
    a = (cx + inward * 7.6, y + 1.5 - tilt)
    b = (cx - inward * 7.6, y + 2.3 + tilt)
    pts = qb(b, (cx, y - 3.0), a, 14)
    L.stroke([(x + 0.5, y2 + 1.5) for x, y2 in pts], (6, 8, 14, 90), 3.4, clip=body)
    L.stroke(pts, (40, 44, 54, 255), 3.0)
    L.stroke(pts, (104, 110, 124, 255), 2.2)
    L.stroke([(x, y2 - 0.5) for x, y2 in pts], (200, 206, 218, 235), 0.8)


def smile(L, p):
    kind, mo, mcur = p['mouth'], p['mo'], p['mcur']
    if kind == 'smirk':
        pts = qb((-6.5, -25.8), (1, -22.4), (7.5, -27.4), 12)
    else:
        depth = mcur + (0.25 * mo if kind in ('open', 'talk', 'o') else 0)
        pts = qb((-7.5, -26.0), (0, -26.0 + 6.4 * depth), (7.5, -26.0), 14)
    L.stroke([(x, y + 0.9) for x, y in pts], (176, 200, 246, 130), 0.8)
    L.stroke(pts, (16, 22, 42, 245), 1.2)


def shutter(L, body, p):
    """Brushed-steel shutter with its read/write window."""
    slide = -p['shut'] * 11
    x0, x1, y0, y1 = -16.5 + slide, 16.5 + slide, -70.8, -48.0
    rec = L.rrect_mask(-16.5, y0 + 1, 16.5, y1, 1.5)
    L._paint(rec, ('ls', [(0, (10, 11, 16, 255)), (1, (50, 54, 66, 255))], (0, y0), (0, y1)))
    L.soft(ImageChops.subtract(rec, shift(rec, 1.2, 1.5)), (0, 0, 0, 200), 0.8, clip=rec)
    plate = L.rrect_mask(x0, y0, x1, y1, 1.8)
    L.soft(plate, (4, 6, 12, 160), 0.9, clip=body, off=(0.7, 1.6))
    for k, col in ((2, (46, 52, 66, 255)), (1, (88, 95, 110, 255))):
        L.rrect(x0 + k * 0.6, y0 + k * 0.7, x1 + k * 0.6, y1 + k * 0.7, 1.8, fill=col)
    L._paint(plate, ('ls', [(0, (204, 208, 216, 255)), (0.45, (164, 169, 178, 255)), (1, (122, 127, 137, 255))], (0, y0), (0, y1)))
    xx = x0 + 1.2
    i = 0
    while xx < x1 - 1:
        L.stroke([(xx, y0 + 1.5), (xx, y1 - 1)], (255, 255, 255, 46) if i % 2 == 0 else (30, 36, 50, 34), 0.5, clip=plate, caps=False)
        xx += 1.1
        i += 1
    L.rrect(x0, y0, x1, y1, 1.8, line=ink(200), lw=0.9)
    bevel(L, plate, 1.2, (255, 255, 255, 190), (10, 14, 26, 130))
    # read/write window
    wx0, wx1, wy0, wy1 = x1 - 11.5, x1 - 5.2, y0 + 5.0, y1 - 4.2
    win = L.rrect_mask(wx0, wy0, wx1, wy1, 0.9)
    L.soft(ImageChops.subtract(shift(win, 1.0, 1.2), win), (255, 255, 255, 200), 0.3, clip=plate)
    L.soft(ImageChops.subtract(shift(win, -0.8, -0.9), win), (10, 14, 24, 170), 0.4, clip=plate)
    L._paint(win, ('ls', [(0, (238, 240, 244, 255)), (1, (206, 210, 218, 255))], (0, wy0), (0, wy1)))
    L.soft(ImageChops.subtract(win, shift(win, 1.3, 1.5)), (20, 26, 40, 190), 0.5, clip=win)
    # clip notch on the left
    L.stroke([(x0 + 4.2, y0 + 4.5), (x0 + 4.2, y1 - 3.5)], (20, 26, 40, 150), 0.6, clip=plate, caps=False)
    L.stroke([(x0 + 4.9, y0 + 4.5), (x0 + 4.9, y1 - 3.5)], (255, 255, 255, 120), 0.5, clip=plate, caps=False)


GLYPHS = {
    'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
}


def label(L, body, p):
    """Blue label with the name in a bitmap font. It becomes a progress bar while saving."""
    lab = L.rrect_mask(-23.8, -36, 23.8, -3, 2.2)
    L.soft(lab, (6, 8, 14, 150), 0.9, clip=body, off=(0.6, 1.3))
    L._paint(lab, ('ls', [(0, (253, 252, 247, 255)), (1, (226, 224, 216, 255))], (0, -36), (0, -3)))
    L.rrect(-23.8, -36, 23.8, -3, 2.2, line=ink(150), lw=0.6)
    inner = lab
    for k in range(7):  # ruled paper
        yy = -9.4 - 3.9 * k
        L.stroke([(-22.4, yy), (22.4, yy)], (136, 144, 158, 150), 0.5, clip=lab, caps=False)
    if p['lab'] >= 0:
        track = L.rrect_mask(-17, -16.2, 17, -11, 1.6)
        L._paint(track, ('ls', [(0, (82, 90, 108, 255)), (1, (140, 148, 164, 255))], (0, -16.2), (0, -11)))
        wbar = 34 * max(0.0, min(1.0, p['lab']))
        if wbar > 1.5:
            L._paint(L.rrect_mask(-17, -16.2, -17 + wbar, -11, 1.6), ('ls', [(0, (150, 244, 176, 255)), (0.5, (52, 196, 108, 255)), (1, (20, 140, 76, 255))], (0, -16.2), (0, -11)))
        L.soft(ImageChops.subtract(track, shift(track, 0.8, 1.0)), (0, 0, 0, 150), 0.4, clip=track)
    elif p['scr'] > 0:
        u = 0.95
        total = 6 * 5 + 5
        m = L._mask()
        d = ImageDraw.Draw(m)
        ox = -total * u / 2
        shown = int(6 * min(1, p['scr'] * 1.2) + 0.999)
        for li, ch in enumerate('FLOPPY'[:shown]):
            for r, row in enumerate(GLYPHS[ch]):
                for c, bit in enumerate(row):
                    if bit == '1':
                        x = ox + (li * 6 + c) * u
                        y = -16.4 + r * u
                        X0, Y0 = L.p(x, y)
                        X1, Y1 = L.p(x + u, y + u)
                        d.rectangle([X0, Y0, X1 - 1, Y1 - 1], fill=255)
        L.soft(m, (255, 255, 255, 160), 0.2, off=(0.35, 0.45), clip=inner)
        L._paint(m, (38, 42, 54, 255), clip=inner)
    bevel(L, lab, 1.0, (255, 255, 255, 110), (0, 0, 30, 100), 0.3)


def holes(L, body):
    for cx in (-28.4, 28.4):
        h = L.rrect_mask(cx - 2.6, -9.0, cx + 2.6, -3.8, 0.8)
        L.soft(ImageChops.subtract(shift(h, 1.0, 1.2), h), (255, 255, 255, 200), 0.3, clip=body)
        L.soft(ImageChops.subtract(shift(h, -0.8, -0.9), h), (8, 12, 22, 170), 0.4, clip=body)
        L._paint(h, ('ls', [(0, (14, 16, 22, 255)), (1, (62, 68, 82, 255))], (0, -9), (0, -3.8)))
        L.soft(ImageChops.subtract(h, shift(h, 1.1, 1.3)), (0, 0, 0, 220), 0.4, clip=h)


def icon(L, body):
    """Small molded mark in the top left corner."""
    m = L.union([L.ellipse_mask(-27, -65.2, 1.3, 1.3), L.rrect_mask(-27.5, -62.6, -26.5, -57.5, 0.4)])
    L.soft(m, (255, 255, 255, 190), 0.3, off=(0.5, 0.6), clip=body)
    L.soft(m, (10, 14, 26, 170), 0.3, off=(-0.4, -0.4), clip=body)
    L._paint(m, (150, 156, 168, 255))


# ---------------------------------------------------------------- arms and gloves


def arm_line(L, side, hand):
    s = (29 * side, -27)
    mid = ((s[0] + hand[0]) / 2 + side * 4, (s[1] + hand[1]) / 2 + 1)
    pts = qb(s, mid, hand, 18)
    L.stroke([(x + 0.4, y + 1.0) for x, y in pts], (4, 6, 12, 70), 3.6)
    L.stroke(pts, (74, 80, 94, 255), 3.9)
    L.stroke(pts, (170, 176, 190, 255), 3.0)
    L.stroke([(x - 0.3, y - 0.4) for x, y in pts], (240, 243, 248, 255), 1.1)
    d = (hand[0] - mid[0], hand[1] - mid[1])
    return math.degrees(math.atan2(d[0], -d[1]))


def glove(L, side, pos, style, ang):
    """White cartoon glove. Local frame has the fingers pointing up; ang rotates it (0 = up, 90 = right)."""
    x, y = pos

    def P(a, b):
        r = rot((a, b), ang)
        return (x + r[0], y + r[1])

    def cap(a, b, w):
        A, B = P(*a), P(*b)
        L.stroke([A, B], (110, 118, 138, 255), w + 0.7)
        L.stroke([A, B], (214, 220, 232, 255), w)
        L.stroke([(A[0] - 0.3, A[1] - 0.4), (B[0] - 0.3, B[1] - 0.4)], (255, 255, 255, 255), w * 0.6)

    if style == 'point':
        for i in range(3):
            cap((-2.6 + i * 1.6, -2.4), (-2.6 + i * 1.6, 0.2), 2.0)
        cap((1.4, -3), (1.4, -11), 2.1)
    elif style in ('fist', 'grip'):
        for i in range(4):
            cap((-3.2 + i * 2.1, -3.2), (-3.2 + i * 2.1, -0.6), 2.1)
    else:
        for a, ln in ((-14, 5.0), (-5, 6.2), (5, 6.0), (14, 5.0)):
            base = (a / 14 * 2.6, -2.2)
            tip = rot((0, -ln), a)
            cap(base, (base[0] + tip[0], base[1] + tip[1]), 2.6)
    th = -side * 1.0
    cap((th * 3.6, 0.8), (th * 7.2, -2.0), 2.6)
    L.ellipse(x, y, 5.2, 5.3, fill=('rs', [(0, (255, 255, 255, 255)), (1, (190, 198, 214, 255))], (x - 1.3, y - 1.5), 6.2, 6.2), line=(96, 104, 124, 255), lw=0.8)


# ---------------------------------------------------------------- props (shaded)


def limb(L, start, ang, segs):
    """Stick-like prop, shaded as a cylinder. ang = degrees from 'down' (0 = pointing down)."""
    u = (-math.sin(math.radians(ang)), math.cos(math.radians(ang)))
    n = (-u[1], u[0])
    pos = start
    for length, w0, w1, color in segs:
        e = (pos[0] + u[0] * length, pos[1] + u[1] * length)
        quad = [(pos[0] + n[0] * w0 / 2, pos[1] + n[1] * w0 / 2), (e[0] + n[0] * w1 / 2, e[1] + n[1] * w1 / 2),
                (e[0] - n[0] * w1 / 2, e[1] - n[1] * w1 / 2), (pos[0] - n[0] * w0 / 2, pos[1] - n[1] * w0 / 2)]
        wm = max(w0, w1)
        mid = ((pos[0] + e[0]) / 2, (pos[1] + e[1]) / 2)
        L.poly(quad, fill=('ls', cyl(color), (mid[0] - n[0] * wm / 2, mid[1] - n[1] * wm / 2), (mid[0] + n[0] * wm / 2, mid[1] + n[1] * wm / 2)), line=ink(180), lw=0.6)
        pos = e
    return pos


def draw_prop(L, p):
    prop, pp, pq = p['prop'], p['pp'], p['pq']
    rh, lh = p['rh'], p['lh']
    wood, pink, silver = rgba('#c98a4b'), rgba('#f0a0b4'), rgba('#c4ccda')
    if prop == 'pencil':
        u = pq or 35
        a = math.radians(u)
        tail = (rh[0] + math.sin(a) * 9, rh[1] - math.cos(a) * 9)
        limb(L, tail, u, [(3, 3.8, 3.8, pink), (2.4, 3.8, 3.8, silver), (13, 3.8, 3.8, rgba('#f2b929')), (4.6, 3.8, 0.7, rgba('#e9c690')), (1.2, 0.8, 0.8, rgba('#30343f'))])
    elif prop == 'brush':
        u = pq or 30
        a = math.radians(u)
        tail = (rh[0] + math.sin(a) * 11, rh[1] - math.cos(a) * 11)
        colors = [rgba('#e0394b'), rgba('#f2c230'), rgba('#2fb36f'), rgba('#3a7de8')]
        limb(L, tail, u, [(15, 2.2, 3.0, rgba('#9a6232')), (4.2, 3.6, 3.6, silver), (5.4, 3.6, 0.9, colors[int(pp) % 4])])
    elif prop == 'wand':
        u = pq or 40
        a = math.radians(u)
        tail = (rh[0] + math.sin(a) * 7, rh[1] - math.cos(a) * 7)
        tip = limb(L, tail, u, [(15, 2.4, 2.4, rgba('#3a2a5e')), (3.2, 2.4, 2.4, rgba('#f4f4f8'))])
        glint(L, tip[0], tip[1], 3.5 + 3 * pp)
    elif prop == 'magnifier':
        u = pq or 140
        a = math.radians(u)
        d = (-math.sin(a), math.cos(a))
        lens = (rh[0] + d[0] * 17, rh[1] + d[1] * 17)
        h0, h1 = (rh[0] - d[0] * 3, rh[1] - d[1] * 3), (lens[0] - d[0] * 8, lens[1] - d[1] * 8)
        L.stroke([h0, h1], ink(220), 4.8)
        L.stroke([h0, h1], (70, 62, 58, 255), 3.2)
        L.stroke([(h0[0] - 0.7, h0[1] - 0.7), (h1[0] - 0.7, h1[1] - 0.7)], (150, 140, 130, 220), 0.9)
        L.ellipse(lens[0], lens[1], 9.8, 9.8, fill=('ls', [(0, (252, 253, 255, 255)), (0.5, (124, 132, 148, 255)), (1, (232, 236, 244, 255))], (lens[0] - 9, lens[1] - 9), (lens[0] + 9, lens[1] + 9)), line=ink(200), lw=0.8)
        L.ellipse(lens[0], lens[1], 7.6, 7.6, fill=('rs', [(0, (232, 246, 253, 70)), (1, (150, 192, 218, 125))], (lens[0] - 2, lens[1] - 2), 9, 9), line=ink(150), lw=0.7)
        L.stroke(qb((lens[0] - 5.2, lens[1] - 1), (lens[0] - 4.6, lens[1] - 4.8), (lens[0] - 1, lens[1] - 5.4), 6), (255, 255, 255, 235), 1.3)
    elif prop == 'clip':  # clipboard, held by the left anchor
        c = (lh[0] + 2, lh[1] - 15)
        ang = pq

        def R(pt):
            r = rot((pt[0] - c[0], pt[1] - c[1]), ang)
            return (c[0] + r[0], c[1] + r[1])

        def box(x0, y0, x1, y1):
            return [R(q) for q in [(c[0] + x0, c[1] + y0), (c[0] + x1, c[1] + y0), (c[0] + x1, c[1] + y1), (c[0] + x0, c[1] + y1)]]

        board = box(-12, -15, 12, 15)
        L.soft(L.poly_mask(board), (4, 6, 12, 130), 1.0, off=(1, 1.5))
        L.poly(board, fill=('ls', [(0, (214, 160, 100, 255)), (1, (140, 92, 50, 255))], R((c[0] - 12, c[1] - 15)), R((c[0] + 12, c[1] + 15))), line=ink(190), lw=0.8)
        L.poly(box(-9, -11, 9, 12), fill=('ls', [(0, (255, 255, 255, 255)), (1, (226, 230, 238, 255))], R((c[0], c[1] - 11)), R((c[0], c[1] + 12))), line=ink(110), lw=0.5)
        for i in range(4):
            yy = c[1] - 6 + i * 5.6
            L.stroke([R((c[0] - 2, yy)), R((c[0] + 6, yy))], (120, 128, 148, 255), 0.9)
            if i < int(pp):
                L.stroke([R((c[0] - 7.5, yy)), R((c[0] - 6, yy + 1.4)), R((c[0] - 3.6, yy - 1.8))], (22, 160, 88, 255), 1.4)
        L.poly(box(-4.5, -17.5, 4.5, -12.5), fill=('ls', CHROME, R((c[0], c[1] - 17.5)), R((c[0], c[1] - 12.5))), line=ink(190), lw=0.6)
    elif prop == 'keys':
        L.soft(L.rrect_mask(-24, -7, 24, 5, 3), (4, 6, 12, 150), 1.0, off=(0.8, 1.6))
        L.rrect(-24, -7, 24, 5, 3, fill=('ls', [(0, (226, 230, 238, 255)), (1, (132, 140, 156, 255))], (0, -7), (0, 5)), line=ink(200), lw=0.8)
        for row in range(2):
            for col in range(9):
                kx, ky = -20 + col * 5, -3.8 + row * 4.4
                down = int(pp) == row * 9 + col
                dy = 0.7 if down else 0
                L.rrect(kx - 1.9, ky - 1.4 + dy, kx + 1.9, ky + 1.4 + dy, 0.8, fill=('ls', [(0, (255, 255, 255, 255)), (1, (176, 184, 198, 255))], (kx, ky - 1.4), (kx, ky + 1.4)) if not down else (150, 190, 240, 255), line=ink(110), lw=0.4)
    elif prop == 'ball':
        sphere(L, rh[0] + 1, rh[1] - 5, 4.6, (255, 255, 255, 255), (170, 178, 194, 255), 150)
        L.stroke([(rh[0] - 1, rh[1] - 6), (rh[0] + 1.5, rh[1] - 4), (rh[0] + 3, rh[1] - 6.5)], (110, 118, 136, 200), 0.7)
    elif prop == 'mail':
        x, y = rh[0] + 1, rh[1] - 7
        L.soft(L.rrect_mask(x - 9, y - 6, x + 9, y + 6, 1.4), (4, 6, 12, 140), 0.8, off=(0.8, 1.2))
        L.rrect(x - 9, y - 6, x + 9, y + 6, 1.4, fill=('ls', [(0, (255, 255, 255, 255)), (1, (214, 219, 228, 255))], (x, y - 6), (x, y + 6)), line=ink(190), lw=0.7)
        L.poly([(x - 8.6, y - 5.6), (x + 8.6, y - 5.6), (x, y + 1.6)], fill=('ls', [(0, (236, 240, 247, 255)), (1, (172, 180, 196, 255))], (x, y - 5.6), (x, y + 1.6)), line=ink(150), lw=0.5)
        sphere(L, x, y + 1.6, 1.8, (180, 188, 204, 255), (80, 88, 106, 255), 120)


def draw_hat(L, kind):
    if kind == 'wizard':
        L.soft(L.ellipse_mask(0, -69, 27, 5.5), (4, 6, 12, 130), 1.0, off=(0.8, 1.4))
        L.ellipse(0, -69, 27, 5.5, fill=('ls', [(0, (96, 66, 176, 255)), (0.5, (170, 138, 240, 255)), (1, (50, 30, 112, 255))], (-27, -69), (27, -69)), line=ink(190), lw=0.8)
        cone = [(-19, -69.5), (19, -69.5)] + qb((19, -69.5), (7, -86), (2, -106), 10) + qb((2, -106), (-8, -87), (-19, -69.5), 10)
        L.poly(cone, fill=('ls', [(0, (50, 30, 112, 255)), (0.32, (118, 82, 208, 255)), (0.5, (196, 170, 255, 255)), (0.75, (96, 64, 176, 255)), (1, (40, 24, 90, 255))], (-19, -90), (19, -90)), line=ink(190), lw=0.8)
        L.stroke(qb((-17.5, -74.5), (0, -70.5), (17.5, -74.5), 8), (232, 184, 48, 255), 3.0, clip=L.poly_mask(cone))
        glint(L, -4, -85, 3.0, color=(255, 232, 140, 255))
        glint(L, 5, -94, 2.0, color=(255, 232, 140, 255))
    elif kind == 'beret':
        pts = [rot((18 * math.cos(a / 16 * math.pi * 2), 7.4 * math.sin(a / 16 * math.pi * 2)), -10) for a in range(16)]
        pts = [(x - 3, y - 73.5) for x, y in pts]
        L.soft(L.poly_mask(pts), (4, 6, 12, 130), 0.9, off=(0.8, 1.4))
        L.poly(pts, fill=('rs', [(0, (244, 104, 116, 255)), (0.6, (196, 48, 66, 255)), (1, (110, 20, 40, 255))], (-9, -78), 20, 9), line=ink(190), lw=0.8)
        sphere(L, -4.5, -82.4, 1.8, (230, 90, 104, 255), (120, 22, 42, 255), 150)
        L.soft(L.ellipse_mask(-9, -76.5, 6, 1.8), (255, 255, 255, 120), 1.0)


# ---------------------------------------------------------------- character


def draw_character(p):
    L = Layer(OX, OY)
    body = L.poly_mask(BODY_PTS)

    # page coming out of the top slot (behind the body)
    if p['sheet'] > 0:
        h = 6 + p['sheet'] * 26
        L.rrect(-13, -70 - h, 13, -62, 1.2, fill=('ls', [(0, (255, 255, 255, 255)), (1, (226, 230, 238, 255))], (0, -70 - h), (0, -62)), line=ink(150), lw=0.7)
        for i in range(int(h // 6)):
            L.stroke([(-9, -70 - h + 5 + i * 5), (9 - (i % 2) * 5, -70 - h + 5 + i * 5)], (120, 128, 146, 220), 0.9)

    arms = [(-1, p['lh'], p['lhs'], p['lha']), (1, p['rh'], p['rhs'], p['rha'])]
    angs = {}
    for side, pos, _, _ in arms:
        if abs(pos[0]) >= 34:
            angs[side] = arm_line(L, side, pos)

    # disk thickness, seen slightly from the upper left
    for k, col in ((3, (62, 68, 82, 255)), (2, (88, 95, 110, 255)), (1, (120, 127, 141, 255))):
        L.poly([(x + k * 0.9, y + k * 1.0) for x, y in BODY_PTS], fill=col)
    L.poly(BODY_PTS, fill=PLASTIC)
    tex = brushed()
    L._paint(tex.point(lambda v: int(v * 0.18)), (255, 255, 255, 255), clip=body)
    L._paint(tex.point(lambda v: int((255 - v) * 0.16)), (24, 30, 44, 255), clip=body)
    L.poly(BODY_PTS, line=ink(215), lw=1.1)
    bevel(L, body, 1.8, (255, 255, 255, 225), (8, 12, 24, 130), 0.45)
    L._paint(L.ellipse_mask(-6, -92, 58, 54), ('ls', [(0, (255, 255, 255, 105)), (1, (255, 255, 255, 0))], (0, -70), (0, -38)), clip=body)
    icon(L, body)
    holes(L, body)
    shutter(L, body, p)
    label(L, body, p)

    for cx, o, side, tilt in ((-10.6, p['ol'], -1, p['tl']), (10.6, p['orr'], 1, p['tr'])):
        eyeball(L, body, cx, side, o, p['es'], p['lx'], p['ly'], p['esc'], tilt)
    brow(L, body, -10.6, -1, p['bl'], p['tl'])
    brow(L, body, 10.6, 1, p['br'], p['tr'])
    smile(L, p)

    if p['flash'] > 0:
        L.poly(BODY_PTS, fill=(255, 255, 255, int(235 * min(1, p['flash']))), clip=body)

    for side, pos, _, _ in arms:
        if abs(pos[0]) < 34:
            angs[side] = arm_line(L, side, pos)
    draw_prop(L, p)
    for side, pos, style, a in arms:
        glove(L, side, pos, style, a if style == 'point' else angs.get(side, 180))
    if p['hat']:
        draw_hat(L, p['hat'])
    return L


# ---------------------------------------------------------------- effects (not attached to the body)

CONFETTI = [rgba(c) for c in ('#ffffff', '#dfe3ea', '#aab2c2', '#6e778b', '#3b4252')]


def draw_fx(F, kind, t, p):
    if not kind:
        return
    if kind == 'think':
        sphere(F, 14, -78, 2.4, (255, 255, 255, 255), (178, 186, 202, 255), 150)
        sphere(F, 19, -84.5, 3.3, (255, 255, 255, 255), (178, 186, 202, 255), 150)
        cl = [(26, -91, 8), (35, -95, 9.5), (45, -91, 8), (36, -86, 8)]
        u = F.union([F.ellipse_mask(x, y, r, r) for x, y, r in cl])
        F.soft(u, (4, 6, 12, 120), 1.0, off=(0.8, 1.4))
        F._paint(u, ('ls', [(0, (255, 255, 255, 255)), (0.6, (236, 239, 245, 255)), (1, (190, 197, 212, 255))], (0, -104), (0, -78)))
        F._paint(ImageChops.subtract(u, erode(u, 0.9)), ink(150))
        n = min(3, int(t * 3) + 1)
        for i in range(n):
            sphere(F, 28.5 + i * 7.5, -91, 2.0, (110, 118, 136, 255), (20, 24, 34, 255), 0)
    elif kind == 'excl':
        s = max(0.01, t)
        sphere(F, 0, -86, 11 * s, (255, 150, 140, 255), (168, 16, 32, 255))
        cy = -86
        F.rrect(-1.7 * s, cy - 7 * s, 1.7 * s, cy + 1.4 * s, 1.4 * s, fill=(255, 255, 255, 255))
        F.ellipse(0, cy + 5.4 * s, 1.9 * s, 1.9 * s, fill=(255, 255, 255, 255))
    elif kind == 'lines':
        a = int(255 * max(0, min(1, 1.6 - t * 1.4)))
        for sx in (-1, 1):
            for ang, r0 in [(-35, 38), (-12, 40), (12, 40)]:
                d = rot((sx, 0), ang * sx)
                x0, y0 = d[0] * (r0 + t * 4), -34 + d[1] * (r0 + t * 4)
                F.stroke([(x0, y0), (x0 + d[0] * 6, y0 + d[1] * 6)], (30, 36, 50, a), 2.0)
    elif kind == 'sparkle':
        rnd = random.Random(11)
        for i in range(9):
            x, y = rnd.uniform(-46, 46), rnd.uniform(-100, -8)
            ph = (t * 1.6 + rnd.random()) % 1
            r = 6.5 * math.sin(math.pi * ph) ** 1.3
            if r > 0.7:
                glint(F, x, y, r, ph * 40)
    elif kind == 'burst':
        rnd = random.Random(5)
        for i in range(10):
            ang = rnd.uniform(0, 2 * math.pi)
            dist = (10 + rnd.uniform(0, 14)) + t * (22 + rnd.uniform(0, 20))
            x, y = math.cos(ang) * dist, -34 + math.sin(ang) * dist * 0.9
            r = 5.5 * math.sin(math.pi * min(1, t * 1.1)) + 0.1
            if r > 0.7:
                glint(F, x, y, r, t * 60)
    elif kind == 'confetti':
        rnd = random.Random(23)
        for i in range(30):
            vx, vy = rnd.uniform(-34, 34), rnd.uniform(-62, -26)
            x, y = vx * t * 1.4, -68 + vy * t + 120 * t * t
            ang = rnd.uniform(0, 360) + rnd.uniform(-420, 420) * t
            col = CONFETTI[i % len(CONFETTI)]
            col = (col[0], col[1], col[2], int(255 * min(1, (1 - t) * 4 + 0.2)))
            w, h = rnd.uniform(2.2, 3.6), rnd.uniform(1.4, 2.4)
            quad = [rot((px, py), ang) for px, py in [(-w, -h), (w, -h), (w, h), (-w, h)]]
            F.poly([(x + a, y + b) for a, b in quad], fill=col, line=(30, 36, 50, col[3] // 2), lw=0.4)
    elif kind == 'zzz':
        for i in range(3):
            ph = (t + i * 0.34) % 1
            s = 3.0 + i * 1.6
            x, y = 30 + ph * 14 + i * 3, -80 - ph * 22
            a = int(255 * math.sin(math.pi * ph))
            pts = [(x - s, y - s), (x + s, y - s), (x - s, y + s), (x + s, y + s)]
            F.stroke(pts, (22, 26, 36, a), 3.6)
            F.stroke(pts, (255, 255, 255, a), 1.5)
    elif kind == 'check':
        s = max(0.01, t)
        cx, cy = 29, -75
        sphere(F, cx, cy, 10 * s, (160, 244, 180, 255), (12, 112, 60, 255))
        F.stroke([(cx - 4.6 * s + 0.5, cy + 0.2 * s + 0.7), (cx - 1.4 * s + 0.5, cy + 3.6 * s + 0.7), (cx + 4.8 * s + 0.5, cy - 3.6 * s + 0.7)], (0, 60, 30, 130), 2.6)
        F.stroke([(cx - 4.6 * s, cy + 0.2 * s), (cx - 1.4 * s, cy + 3.6 * s), (cx + 4.8 * s, cy - 3.6 * s)], (255, 255, 255, 255), 2.5)
    elif kind == 'gear':
        cx, cy = 26, -88
        pts = []
        for i in range(8):
            a0, a1 = math.radians(i * 45 + t * 360 - 12), math.radians(i * 45 + t * 360 + 12)
            pts += [(cx + 7.6 * math.cos(a0), cy + 7.6 * math.sin(a0)), (cx + 10.6 * math.cos(a0 + 0.12), cy + 10.6 * math.sin(a0 + 0.12)),
                    (cx + 10.6 * math.cos(a1 - 0.12), cy + 10.6 * math.sin(a1 - 0.12)), (cx + 7.6 * math.cos(a1), cy + 7.6 * math.sin(a1))]
        F.soft(F.poly_mask(pts), (4, 6, 12, 130), 0.9, off=(0.8, 1.2))
        F.poly(pts, fill=('ls', CHROME, (cx, cy - 10.6), (cx, cy + 10.6)), line=ink(200), lw=0.8)
        F.ellipse(cx, cy, 3.6, 3.6, fill=(14, 16, 22, 255), line=ink(200), lw=0.8)
        F.soft(F.ellipse_mask(cx - 3, cy - 4.5, 3, 1.6), (255, 255, 255, 180), 0.6)
    elif kind == 'binary':
        rnd = random.Random(3)
        for i in range(7):
            ph = (t + rnd.random()) % 1
            x, y = -34 + i * 11 + rnd.uniform(-2, 2), -74 - ph * 34
            a = int(235 * math.sin(math.pi * ph))
            col = (84, 255, 160, a)
            F.soft(F.ellipse_mask(x, y, 3, 5), (84, 255, 160, a // 2), 1.6)
            if i % 2:
                F.stroke([(x - 1.6, y - 3), (x, y - 4.6), (x, y + 4.6)], col, 1.6)
            else:
                F.ellipse(x, y, 2.3, 4.2, line=col, lw=1.4)
    elif kind == 'waves':
        for i in range(3):
            ph = (t + i * 0.3) % 1
            r = 6 + ph * 14
            a = int(220 * math.sin(math.pi * ph))
            F.stroke(qb((44 + r * 0.2, -52 - r), (44 + r, -52), (44 + r * 0.2, -52 + r), 10), (40, 48, 70, a), 2.0)
    elif kind == 'dust':
        for sx in (-1, 1):
            for k in range(2):
                r = 3 + t * 6 + k * 1.5
                x = sx * (30 + t * 14 + k * 5)
                F.soft(F.ellipse_mask(x, -3 - k * 2 - t * 4, r, r * 0.8), (255, 255, 255, int(190 * (1 - t))), 0.9)
    elif kind == 'paint':
        strokes = [((24, -74), (44, -88), (58, -68), rgba('#e0394b')), ((26, -62), (46, -72), (58, -52), rgba('#f2c230')), ((20, -92), (34, -106), (52, -94), rgba('#3a7de8'))]
        for i, (a, b, c, col) in enumerate(strokes):
            q = max(0, min(1, t * 3 - i))
            if q > 0:
                pts = qb(a, b, c, 16)[: max(2, int(17 * q))]
                F.stroke(pts, ink(200), 6.4)
                F.stroke(pts, mul(col, 0.8), 4.6)
                F.stroke([(x, y - 0.8) for x, y in pts], lighten(col, 0.5), 2.0)
                F.stroke([(x - 0.4, y - 1.4) for x, y in pts], (255, 255, 255, 160), 0.7)
    elif kind == 'bin':
        x = 44
        body = [(x - 9, -26), (x + 9, -26), (x + 7.4, -2), (x - 7.4, -2)]
        F.soft(F.poly_mask(body), (4, 6, 12, 130), 1.0, off=(0.8, 1.4))
        F.poly(body, fill=('ls', [(0, (120, 128, 144, 255)), (0.28, (246, 248, 252, 255)), (0.6, (188, 196, 210, 255)), (1, (100, 108, 124, 255))], (x - 9, 0), (x + 9, 0)), line=ink(200), lw=0.9)
        for k in (-3.6, 0, 3.6):
            F.stroke([(x + k, -22), (x + k * 0.8, -6)], (90, 98, 116, 200), 0.9)
        ang = -t * 36
        corners = [rot((0, -3.6), ang), rot((20, -3.6), ang), rot((20, 0), ang), rot((0, 0), ang)]
        F.poly([(x - 10 + cx, -27 + cy) for cx, cy in corners], fill=('ls', CHROME, (x, -31), (x, -26)), line=ink(200), lw=0.8)
    elif kind == 'ball':
        x = 30 + 14 * t
        y = -48 + 20 * t - math.sin(math.pi * t) * 20
        sphere(F, x, y, 4.5, (255, 255, 255, 255), (170, 178, 194, 255), 150)
    elif kind == 'mail':
        x, y = 40 + t * 60, -48 - t * 80
        a = int(255 * min(1, (1 - t) * 3))
        F.rrect(x - 9, y - 6, x + 9, y + 6, 1.4, fill=('ls', [(0, (255, 255, 255, a)), (1, (214, 219, 228, a))], (x, y - 6), (x, y + 6)), line=(22, 26, 36, a), lw=0.7)
        F.poly([(x - 8.6, y - 5.6), (x + 8.6, y - 5.6), (x, y + 1.6)], fill=(200, 206, 220, a), line=(22, 26, 36, a // 2), lw=0.5)
        for i in range(3):
            tt = max(0, t - 0.08 * (i + 1))
            F.soft(F.ellipse_mask(40 + tt * 60 - 12, -48 - tt * 80 + 6, 2.2, 2.2), (255, 255, 255, int(a * 0.8)), 0.7)


# ---------------------------------------------------------------- frame


def render_frame(p, bg=None):
    F = Layer(OX, OY)
    lift = max(0.0, -p['dy'])
    k = 1 / (1 + lift / 55)
    soft_shadow(F, p['dx'] * 0.8 + 2, 4, 30 * k * p['sx'], 5.2 * k, 85 * k * p['alpha'])
    soft_shadow(F, p['dx'] * 0.8 + 1, 3, 22 * k * p['sx'], 2.4 * k, 120 * k * p['alpha'])
    ch = draw_character(p)
    img = transform(ch.im, p['dx'], p['dy'], p['rot'], p['sx'], p['sy'])
    if p['alpha'] < 1:
        img.putalpha(img.getchannel('A').point(lambda v: int(v * max(0, p['alpha']))))
    F.im.alpha_composite(img)
    draw_fx(F, p['fx'], p['ft'], p)
    draw_fx(F, p['fx2'], p['ft2'], p)
    out = finish(F.im)
    if bg is not None:
        base = Image.new('RGBA', out.size, bg)
        base.alpha_composite(out)
        return base
    return out
