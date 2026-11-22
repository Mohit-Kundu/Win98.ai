"""Drawing engine for the Floppy agent: supersampled vector-style rendering with Pillow.

Everything is drawn at SS x resolution into RGBA layers and downsampled with premultiplied alpha,
so edges are smooth and there are no dark fringes. Coordinates passed to Layer methods are in
frame pixels relative to the layer origin (ox, oy).
"""
import math

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

W, H, SS = 120, 128, 4
OX, OY = 60, 108  # body pivot (bottom centre of the disk) in frame pixels


def rgba(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


NAVY = rgba('#1c2028')  # ink colour used for every outline
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return a + (b - a) * t


def qb(p0, p1, p2, n=14):
    return [
        (
            (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
        )
        for t in (i / n for i in range(n + 1))
    ]


def rpoly(pts, radii, n=6):
    """Polygon with rounded corners (quadratic arcs)."""
    out = []
    k = len(pts)
    for i, v in enumerate(pts):
        p, q = pts[i - 1], pts[(i + 1) % k]
        r = radii[i] if isinstance(radii, (list, tuple)) else radii

        def toward(a, b, d):
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = math.hypot(dx, dy)
            d = min(d, length / 2)
            return (a[0] + dx / length * d, a[1] + dy / length * d)

        out += qb(toward(v, p, r), v, toward(v, q, r), n)
    return out


def rot(pt, deg, c=(0, 0)):
    a = math.radians(deg)
    x, y = pt[0] - c[0], pt[1] - c[1]
    return (c[0] + x * math.cos(a) - y * math.sin(a), c[1] + x * math.sin(a) + y * math.cos(a))


class Layer:
    def __init__(self, ox, oy):
        self.ox, self.oy = ox, oy
        self.im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))

    # -- coordinate helpers
    def p(self, x, y):
        return ((self.ox + x) * SS, (self.oy + y) * SS)

    def pts(self, pts):
        return [self.p(*q) for q in pts]

    def _mask(self):
        return Image.new('L', self.im.size, 0)

    # -- painting
    def _paint(self, mask, fill, clip=None):
        if clip is not None:
            mask = ImageChops.multiply(mask, clip)
        bb = mask.getbbox()
        if not bb:
            return
        x0, y0, x1, y1 = bb
        m = mask.crop(bb)
        w, h = x1 - x0, y1 - y0
        if fill[0] in ('ls', 'rs'):
            ys = (np.arange(y0, y1) + 0.5)[:, None]
            xs = (np.arange(x0, x1) + 0.5)[None, :]
            if fill[0] == 'ls':
                _, stops, a, b = fill
                ax, ay = self.p(*a)
                bx, by = self.p(*b)
                dx, dy = bx - ax, by - ay
                t = ((xs - ax) * dx + (ys - ay) * dy) / (dx * dx + dy * dy)
            else:
                _, stops, c, rx, ry = fill
                cx, cy = self.p(*c)
                t = np.hypot((xs - cx) / (rx * SS), (ys - cy) / (ry * SS))
            t = np.clip(t, 0, 1)
            ts = [s[0] for s in stops]
            cols = np.array([s[1] for s in stops], float)
            arr = np.stack([np.interp(t, ts, cols[:, k]) for k in range(4)], axis=-1)
            col = Image.fromarray(arr.astype('uint8'), 'RGBA')
        elif fill[0] == 'g':
            _, c0, c1, box, mode = fill
            bx0, by0 = self.p(box[0], box[1])
            bx1, by1 = self.p(box[2], box[3])
            ys = (np.arange(y0, y1) + 0.5)[:, None]
            xs = (np.arange(x0, x1) + 0.5)[None, :]
            if mode == 'v':
                t = (ys - by0) / (by1 - by0) + 0 * xs
            elif mode == 'h':
                t = (xs - bx0) / (bx1 - bx0) + 0 * ys
            elif mode == 'r':  # radial from the box centre
                cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
                t = np.hypot((xs - cx) / ((bx1 - bx0) / 2), (ys - cy) / ((by1 - by0) / 2))
            else:  # diagonal top-left -> bottom-right
                t = ((xs - bx0) / (bx1 - bx0) + (ys - by0) / (by1 - by0)) / 2
            t = np.clip(t, 0, 1)[..., None]
            arr = np.array(c0, float) * (1 - t) + np.array(c1, float) * t
            col = Image.fromarray(arr.astype('uint8'), 'RGBA')
        else:
            col = Image.new('RGBA', (w, h), tuple(fill))
        col.putalpha(ImageChops.multiply(col.getchannel('A'), m))
        self.im.alpha_composite(col, (x0, y0))

    def shape(self, drawfn, fill=None, line=None, lw=0, clip=None):
        if fill is not None:
            m = self._mask()
            drawfn(ImageDraw.Draw(m), 255, None, 0)
            self._paint(m, fill, clip)
        if line is not None and lw > 0:
            m = self._mask()
            drawfn(ImageDraw.Draw(m), None, 255, max(1, round(lw * SS)))
            self._paint(m, line, clip)

    def ellipse(self, cx, cy, rx, ry, fill=None, line=None, lw=0, clip=None):
        bb = [*self.p(cx - rx, cy - ry), *self.p(cx + rx, cy + ry)]
        self.shape(lambda d, f, o, w: d.ellipse(bb, fill=f, outline=o, width=w), fill, line, lw, clip)

    def rrect(self, x0, y0, x1, y1, r, fill=None, line=None, lw=0, clip=None):
        bb = [*self.p(x0, y0), *self.p(x1, y1)]
        self.shape(
            lambda d, f, o, w: d.rounded_rectangle(bb, radius=r * SS, fill=f, outline=o, width=w),
            fill, line, lw, clip,
        )

    def poly(self, pts, fill=None, line=None, lw=0, clip=None):
        P = self.pts(pts)
        self.shape(lambda d, f, o, w: d.polygon(P, fill=f, outline=o, width=w), fill, line, lw, clip)

    def stroke(self, pts, color, w, clip=None, caps=True):
        P = self.pts(pts)
        m = self._mask()
        d = ImageDraw.Draw(m)
        d.line(P, fill=255, width=max(1, round(w * SS)), joint='curve')
        if caps:
            r = w * SS / 2
            for x, y in (P if len(P) <= 30 else [P[0], P[-1]]):
                d.ellipse([x - r, y - r, x + r, y + r], fill=255)
        self._paint(m, color, clip)

    def poly_mask(self, pts):
        m = self._mask()
        ImageDraw.Draw(m).polygon(self.pts(pts), fill=255)
        return m

    def ellipse_mask(self, cx, cy, rx, ry):
        m = self._mask()
        ImageDraw.Draw(m).ellipse([*self.p(cx - rx, cy - ry), *self.p(cx + rx, cy + ry)], fill=255)
        return m


def transform(im, dx, dy, rot_deg, sx, sy):
    """Scale, rotate about the pivot, then translate. Uses premultiplied alpha to avoid fringes."""
    px, py = OX * SS, OY * SS
    th = math.radians(rot_deg)
    c, s = math.cos(th), math.sin(th)
    M = np.array([[c, -s], [s, c]]) @ np.diag([sx, sy])
    Mi = np.linalg.inv(M)
    t = np.array([px + dx * SS, py + dy * SS])
    off = np.array([px, py]) - Mi @ t
    coeffs = (Mi[0, 0], Mi[0, 1], off[0], Mi[1, 0], Mi[1, 1], off[1])
    return im.convert('RGBa').transform(im.size, Image.AFFINE, coeffs, resample=Image.BICUBIC).convert('RGBA')


def finish(im):
    """Downsample the supersampled frame to W x H."""
    return im.convert('RGBa').resize((W, H), Image.LANCZOS).convert('RGBA')


def soft_shadow(layer, cx, cy, rx, ry, alpha):
    m = Image.new('L', layer.im.size, 0)
    ImageDraw.Draw(m).ellipse([*layer.p(cx - rx, cy - ry), *layer.p(cx + rx, cy + ry)], fill=int(alpha))
    m = m.filter(ImageFilter.GaussianBlur(1.6 * SS))
    col = Image.new('RGBA', layer.im.size, (5, 12, 40, 255))
    col.putalpha(m)
    layer.im.alpha_composite(col)


# ---------------------------------------------------------------- masks and soft shading

def shift(m, dx, dy):
    return ImageChops.offset(m, int(round(dx * SS)), int(round(dy * SS)))


def erode(m, px):
    n = int(round(px * SS)) * 2 + 1
    bb = m.getbbox()
    if not bb or n < 3:
        return m
    box = (max(0, bb[0] - n), max(0, bb[1] - n), min(m.width, bb[2] + n), min(m.height, bb[3] + n))
    out = Image.new('L', m.size, 0)
    out.paste(m.crop(box).filter(ImageFilter.MinFilter(n)), box[:2])
    return out


def _soft(self, mask, color, blur, clip=None, off=(0, 0)):
    """Paint `color` through a blurred (and optionally offset) copy of `mask`."""
    if off != (0, 0):
        mask = shift(mask, off[0], off[1])
    bb = mask.getbbox()
    if not bb:
        return
    pad = int(blur * SS * 3) + 2
    box = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(mask.width, bb[2] + pad), min(mask.height, bb[3] + pad))
    out = Image.new('L', mask.size, 0)
    out.paste(mask.crop(box).filter(ImageFilter.GaussianBlur(blur * SS)), box[:2])
    self._paint(out, color, clip)


def _rrect_mask(self, x0, y0, x1, y1, r):
    m = self._mask()
    ImageDraw.Draw(m).rounded_rectangle([*self.p(x0, y0), *self.p(x1, y1)], radius=r * SS, fill=255)
    return m


def _union(self, masks):
    out = masks[0]
    for m in masks[1:]:
        out = ImageChops.lighter(out, m)
    return out


Layer.soft = _soft
Layer.rrect_mask = _rrect_mask
Layer.union = _union
