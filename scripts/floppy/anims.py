"""Animation definitions for Floppy.

An animation is a list of keys. Each key is a pose (absolute, merged onto REST), a hold time, and the
number of tween frames used to get there from the previous key. `loop=(a, b)` loops keys a..b until the
animation is told to exit; key b must match the pose of key a-1 so the loop is seamless. Unless `noend`
is set, the animation tweens back to REST and ends on it.
"""
import math

from character import REST

STEP = 60  # ms per tween frame


def K(hold=80, n=2, *rest, snd=None, **c):
    ease_name, pose = 'io', {}
    for r in rest:
        if isinstance(r, str):
            ease_name = r
        else:
            pose.update(r)
    pose.update(c)
    return dict(hold=hold, n=n, ease=ease_name, snd=snd, pose=pose)


def ease(name, u):
    if name == 'out':
        return 1 - (1 - u) ** 3
    if name == 'back':
        c1 = 1.9
        return 1 + (c1 + 1) * (u - 1) ** 3 + c1 * (u - 1) ** 2
    if name == 'lin':
        return u
    return u * u * (3 - 2 * u)


def mix(a, b, u):
    out = {}
    for k, bv in b.items():
        av = a[k]
        if isinstance(bv, (int, float)) and not isinstance(bv, bool) and isinstance(av, (int, float)):
            out[k] = av + (bv - av) * u
        elif isinstance(bv, tuple) and isinstance(av, tuple):
            out[k] = tuple(x + (y - x) * u for x, y in zip(av, bv))
        else:
            out[k] = bv if u >= 0.5 else av
    return out


def build(anim):
    """Returns (frames, loop) where frames = [(pose, duration, sound)] and loop = (start, end, exit) or None."""
    keys = anim['keys']
    frames, kstart, kframe = [], {}, {}
    prev = None
    for i, k in enumerate(keys):
        tgt = {**REST, **k['pose']}
        kstart[i] = len(frames)
        if prev is not None and k['n'] > 0:
            for j in range(k['n']):
                u = ease(k['ease'], (j + 1) / (k['n'] + 1))
                frames.append((mix(prev, tgt, u), STEP, None))
        kframe[i] = len(frames)
        frames.append((tgt, k['hold'], k['snd']))
        prev = tgt
    if not anim.get('noend'):
        for j in range(2):
            frames.append((mix(prev, REST, ease('io', (j + 1) / 3)), STEP, None))
        frames.append((dict(REST), 100, None))
    loop = None
    if anim.get('loop'):
        a, b = anim['loop']
        loop = (kstart[a], kframe[b], kframe[b] + 1)
    return frames, loop


# --------------------------------------------------------------- shared looks

HAPPY = dict(es='happy', mouth='open', mo=0.6, bl=3, br=3)
ARMS_UP = dict(lh=(-47, -76), rh=(47, -76))


def wave(x, y):
    return dict(rh=(x, y), rhs='open')


def look(name, lx, ly, rot=0):
    return dict(keys=[K(100, 2, lx=lx, ly=ly, rot=rot, bl=1.5 * (ly < 0), br=1.5 * (ly < 0)), K(560, 0, lx=lx, ly=ly, rot=rot, bl=1.5 * (ly < 0), br=1.5 * (ly < 0))])


A = {}

A['RestPose'] = dict(keys=[K(100, 0)], noend=True)

A['Show'] = dict(keys=[
    K(60, 0, alpha=0, dy=-46, sy=1.12, sx=0.9, es='wide'),
    K(100, 3, 'lin', snd='pop', alpha=1, dy=0, sy=0.76, sx=1.15, es='n', fx='dust', ft=0.15),
    K(70, 2, HAPPY, dy=-9, sy=1.1, sx=0.94, fx='dust', ft=0.6, fx2='burst', ft2=0.1),
    K(80, 2, HAPPY, sy=0.94, sx=1.04, fx2='burst', ft2=0.45),
    K(220, 2, HAPPY, fx2='burst', ft2=0.9),
])

A['Hide'] = dict(noend=True, keys=[
    K(90, 2, es='wide', sy=0.84, sx=1.1, mouth='o', mo=0.4),
    K(60, 2, snd='whoosh', dy=-14, sy=1.12, sx=0.92, es='wide', mouth='o', mo=0.4),
    K(60, 3, dy=-34, sx=0.3, sy=0.3, alpha=0.5, rot=14, fx='burst', ft=0.3),
    K(80, 2, dy=-40, sx=0.05, sy=0.05, alpha=0, rot=40, fx='burst', ft=0.9),
])

A['Greeting'] = dict(keys=[
    K(80, 3, sy=0.9, sx=1.06),
    K(90, 3, HAPPY, wave(46, -56), snd='blip', dy=-12, sy=1.06, fx='sparkle', ft=0.2),
    K(70, 2, HAPPY, wave(52, -63), sy=0.94, sx=1.05),
    K(70, 2, HAPPY, wave(46, -52), dy=0, sy=1, sx=1),
    K(70, 2, HAPPY, wave(53, -63)),
    K(70, 2, HAPPY, wave(46, -52)),
    K(70, 2, HAPPY, wave(53, -63)),
    K(160, 2, HAPPY, wave(46, -58), fx='sparkle', ft=0.9),
])

A['Wave'] = dict(keys=[
    K(90, 3, HAPPY, wave(46, -56)),
    K(70, 2, HAPPY, wave(53, -64), rot=2),
    K(70, 2, HAPPY, wave(45, -52), rot=-1),
    K(70, 2, HAPPY, wave(53, -64), rot=2),
    K(70, 2, HAPPY, wave(45, -52), rot=-1),
    K(200, 2, HAPPY, wave(48, -58)),
])

A['GoodBye'] = dict(keys=[
    K(90, 3, HAPPY, wave(46, -56)),
    K(70, 2, HAPPY, wave(53, -64), rot=2),
    K(70, 2, HAPPY, wave(45, -52), rot=-1),
    K(70, 2, HAPPY, wave(53, -64), rot=2),
    K(130, 3, wave(40, -10), es='closed', mouth='smile', mcur=1.2, rot=7, sy=0.94),
    K(260, 0, es='closed', mouth='smile', mcur=1.2, rot=7, sy=0.94),
])

A['Congratulate'] = dict(keys=[
    K(100, 3, sy=0.8, sx=1.1, lh=(-44, -14), rh=(44, -14), mouth='open', mo=0.4),
    K(90, 3, 'out', ARMS_UP, HAPPY, snd='tada', dy=-28, sy=1.12, sx=0.92, mo=0.9, bl=5, br=5, fx='confetti', ft=0.08, fx2='sparkle', ft2=0.1),
    K(80, 2, ARMS_UP, HAPPY, dy=-32, ft=0.3, ft2=0.3, mo=0.9),
    K(80, 2, ARMS_UP, HAPPY, dy=-14, sy=1.03, sx=1, ft=0.5, ft2=0.5, mo=0.9),
    K(90, 2, HAPPY, dy=0, sy=0.84, sx=1.1, ft=0.68, fx2='dust', ft2=0.25, lh=(-46, -40), rh=(46, -40)),
    K(80, 2, ARMS_UP, HAPPY, dy=-7, sy=1.04, ft=0.82, ft2=0.8),
    K(300, 2, HAPPY, dy=0, sy=1, sx=1, ft=1, fx2=None, lh=(-46, -50), rh=(46, -50)),
])

shake = dict(es='wide', mouth='o', mo=0.5, bl=6, br=6, tl=1.6, tr=1.6, fx='excl')
A['Alert'] = dict(keys=[
    K(60, 2, 'back', shake, snd='alert', sy=1.1, sx=0.92, dy=-6, ft=0.75),
    K(60, 1, shake, rot=-5, ft=1.1, fx2='lines', ft2=0.1),
    K(60, 1, shake, rot=5, ft=1.0, ft2=0.3),
    K(60, 1, shake, rot=-4, ft=1.05, ft2=0.5),
    K(60, 1, shake, rot=4, ft=1.0, ft2=0.7),
    K(70, 1, shake, rot=-2, ft=1.0, ft2=0.9),
    K(500, 2, shake, rot=0, sy=1, sx=1, dy=0, ft=1.0),
])

# --- thinking (loop)
T0 = dict(lx=0.8, ly=-0.8, bl=3, tr=-1.5, mouth='smirk', rh=(21, -22), rhs='fist', rot=2, fx='think', ft=0.0)
A['Thinking'] = dict(loop=(1, 4), keys=[
    K(100, 3, T0),
    K(240, 2, {**T0, 'ft': 0.4, 'rot': -1.5, 'ly': -0.6}),
    K(240, 2, {**T0, 'ft': 0.7, 'rot': -1, 'ly': -0.9, 'lx': 0.4}),
    K(240, 2, {**T0, 'ft': 0.99, 'rot': 1, 'lx': 0.9}),
    K(200, 2, T0),
])

# --- explaining (loop)
E0 = dict(lx=0.25, bl=1.5, br=1.5, mouth='talk', mo=0.5, rh=(44, -34))
A['Explain'] = dict(loop=(1, 4), keys=[
    K(90, 3, E0),
    K(100, 1, {**E0, 'mo': 0.95, 'rh': (47, -46), 'bl': 3, 'br': 3, 'dy': -2}),
    K(90, 1, {**E0, 'mo': 0.1, 'rh': (44, -30), 'rot': -1.5}),
    K(100, 1, {**E0, 'mo': 0.8, 'rh': (48, -50), 'lh': (-44, -30), 'lx': -0.2, 'bl': 3.5, 'dy': -1.5}),
    K(90, 1, E0),
])

# --- writing (loop): the pencil scribbles on its own label
W0 = dict(prop='pencil', rh=(8, -15), rhs='grip', pq=35, ly=0.8, lx=-0.4, mouth='smile', bl=1, br=1)
A['Writing'] = dict(loop=(1, 4), keys=[
    K(110, 3, W0),
    K(80, 1, {**W0, 'rh': (14, -13), 'lx': 0.4, 'pq': 28}),
    K(80, 1, {**W0, 'rh': (3, -13.5), 'lx': -0.5, 'pq': 40, 'rot': 0.8}),
    K(80, 1, {**W0, 'rh': (15, -14.5), 'lx': 0.5, 'pq': 30, 'rot': -0.6}),
    K(80, 1, W0),
])

# --- painting (loop)
P0 = dict(hat='beret', prop='brush', rh=(38, -36), rhs='grip', pq=30, pp=0, lx=0.7, ly=-0.3, mouth='smile', fx='paint', ft=0.0, rot=1)
A['GetArtsy'] = dict(loop=(1, 4), keys=[
    K(110, 3, P0),
    K(110, 1, {**P0, 'rh': (40, -52), 'pq': 20, 'ft': 0.34, 'pp': 1, 'rot': -1, 'ly': -0.7}),
    K(110, 1, {**P0, 'rh': (45, -46), 'pq': 40, 'ft': 0.67, 'pp': 2, 'rot': 1.5}),
    K(110, 1, {**P0, 'rh': (42, -62), 'pq': 25, 'ft': 1.0, 'pp': 3, 'rot': -1, 'ly': -0.8}),
    K(110, 1, P0),
])

# --- searching (loop)
S0 = dict(prop='magnifier', rh=(32, -24), rhs='grip', pq=135, lx=0.7, bl=2, tr=-1.2, mouth='o', mo=0.15)
A['Searching'] = dict(loop=(1, 4), keys=[
    K(110, 3, S0),
    K(100, 2, {**S0, 'rh': (12, -26), 'lx': -0.2, 'rot': -2, 'ly': 0.3}),
    K(100, 2, {**S0, 'rh': (-6, -30), 'pq': 140, 'lx': -0.8, 'rot': -3}),
    K(100, 2, {**S0, 'rh': (20, -34), 'lx': 0.2, 'rot': 1, 'ly': -0.3}),
    K(100, 2, S0),
])

# --- trash
BIN = dict(dx=-10, fx='bin', ft=0.0)
A['EmptyTrash'] = dict(keys=[
    K(90, 3, BIN, prop='ball', rh=(46, -26), rhs='grip', lx=0.8, mouth='smirk'),
    K(90, 2, BIN, rot=-5, prop='ball', rh=(40, -50), rhs='grip', lx=0.5, ly=-0.4, mouth='smirk'),
    K(70, 2, 'out', rot=6, rh=(54, -34), rhs='open', lx=0.9, mouth='smirk', fx='bin', ft=0.5, dx=-10, fx2='ball', ft2=0.1),
    K(80, 2, 'lin', rot=2, rh=(48, -40), rhs='open', lx=0.9, fx='bin', ft=1.0, dx=-10, fx2='ball', ft2=0.55),
    K(80, 2, 'lin', rot=0, rh=(46, -32), rhs='open', lx=0.9, fx='bin', ft=0.9, dx=-10, fx2='ball', ft2=0.98),
    K(100, 2, HAPPY, snd='pop', dy=-8, sy=1.08, sx=0.94, lh=(-47, -50), rh=(47, -50), fx='bin', ft=0.5, dx=-10),
    K(260, 2, HAPPY, dy=0, lh=(-47, -44), rh=(47, -44), fx='bin', ft=0.0, dx=-10),
])

# --- save: the shutter slides open, the label becomes a progress bar, then a check pops
SV = dict(es='n', mouth='flat', ly=0.2)
A['Save'] = dict(keys=[
    K(90, 3, SV, sy=0.94, sx=1.04, lab=0, bl=1, br=1),
    K(80, 2, SV, snd='seek', shut=1, lab=0.12),
    K(90, 1, SV, shut=1, lab=0.35, rot=0.9),
    K(90, 1, SV, shut=1, lab=0.58, rot=-0.9),
    K(90, 1, SV, shut=1, lab=0.8, rot=0.9),
    K(100, 1, SV, shut=1, lab=1.0, rot=0),
    K(110, 2, SV, shut=0, lab=1.0),
    K(90, 2, 'back', HAPPY, snd='ding', dy=-9, sy=1.08, sx=0.94, flash=0.7, fx='check', ft=0.8, fx2='burst', ft2=0.1),
    K(100, 2, HAPPY, dy=0, sy=1, sx=1, flash=0, fx='check', ft=1.0, fx2='burst', ft2=0.5),
    K(380, 2, HAPPY, fx='check', ft=1.0, fx2='burst', ft2=0.95),
])

A['Idle1_1'] = dict(keys=[
    K(180, 2, sy=1.022, sx=0.99),
    K(70, 1, ol=0.1, orr=0.1, sy=1.022, sx=0.99),
    K(160, 1, sy=1.0, sx=1.0, lx=0.5),
    K(200, 2, sy=1.02, sx=0.99, lx=-0.4),
])

A['IdleEyeBrowRaise'] = dict(keys=[
    K(110, 2, br=6.5, tr=-1.2, mouth='smirk', lx=0.5, ly=-0.2),
    K(520, 0, br=6.5, tr=-1.2, mouth='smirk', lx=0.5, ly=-0.2),
    K(90, 2, br=5, bl=1.5, mouth='smirk', lx=0.2),
])

tapA, tapB = dict(rh=(36, -17), rhs='fist'), dict(rh=(36, -11), rhs='fist')
A['IdleFingerTap'] = dict(keys=[
    K(100, 3, tapA, lx=0.8, mouth='flat', bl=1, br=1, tl=-1, tr=-1),
    K(70, 0, tapB, lx=0.8, mouth='flat', tl=-1, tr=-1), K(70, 0, tapA, lx=0.8, mouth='flat', tl=-1, tr=-1),
    K(70, 0, tapB, lx=0.8, mouth='flat', tl=-1, tr=-1), K(70, 0, tapA, lx=0.8, mouth='flat', tl=-1, tr=-1),
    K(70, 0, tapB, lx=0.8, mouth='flat', tl=-1, tr=-1), K(70, 0, tapA, lx=0.8, mouth='flat', ol=0.2, orr=0.2, tl=-1, tr=-1),
    K(90, 1, tapB, lx=0.8, mouth='flat', tl=-1, tr=-1),
])

scA, scB = dict(rh=(22, -72), rhs='fist'), dict(rh=(29, -71), rhs='fist')
SC = dict(ly=-0.7, lx=0.3, mouth='wavy', br=3, tr=1.5, bl=1)
A['IdleHeadScratch'] = dict(keys=[
    K(110, 3, scA, SC), K(70, 0, scB, SC), K(70, 0, scA, SC), K(70, 0, scB, SC),
    K(70, 0, scA, SC), K(70, 0, scB, SC), K(90, 2, SC, rh=(26, -72), rhs='fist', es='n'),
])

A['IdleSideToSide'] = dict(keys=[
    K(110, 3, rot=-5, dx=-4, es='happy', mouth='smile', mcur=1.3),
    K(110, 3, rot=5, dx=4, es='happy', mouth='smile', mcur=1.3),
    K(110, 3, rot=-5, dx=-4, es='happy', mouth='smile', mcur=1.3),
    K(110, 3, rot=5, dx=4, es='happy', mouth='smile', mcur=1.3),
    K(110, 3, rot=0, dx=0, es='happy', mouth='smile', mcur=1.3),
])

A['IdleRopePile'] = dict(keys=[
    K(120, 4, sy=1.15, sx=0.93, lh=(-45, -86), rh=(45, -86), es='closed', mouth='o', mo=0.9, bl=3, br=3),
    K(420, 0, sy=1.16, sx=0.92, lh=(-45, -86), rh=(45, -86), es='closed', mouth='o', mo=0.9, bl=3, br=3),
    K(110, 2, sy=0.95, sx=1.03, lh=(-44, -20), rh=(44, -20), es='closed', mouth='smile'),
])

zz = dict(es='closed', mouth='o', mo=0.2, rot=3, fx='zzz')
A['IdleSnooze'] = dict(keys=[
    K(140, 4, zz, sy=0.97, sx=1.01, ft=0.0),
    K(300, 1, {**zz, 'sy': 1.0}, ft=0.25), K(300, 1, zz, sy=0.97, ft=0.5, mo=0.45),
    K(300, 1, zz, sy=1.0, ft=0.75), K(300, 1, zz, sy=0.97, ft=0.99, mo=0.45),
    K(90, 1, 'back', es='wide', dy=-8, sy=1.1, sx=0.93, mouth='o', mo=0.5, fx='excl', ft=0.6),
    K(180, 2, es='n', mouth='smile', fx='excl', ft=0.0),
])

for nm, (lx, ly, r) in dict(
    LookLeft=(-1, 0, -2), LookRight=(1, 0, 2), LookUp=(0, -1, 0), LookDown=(0, 1, 0),
    LookUpLeft=(-0.9, -0.9, -2), LookUpRight=(0.9, -0.9, 2), LookDownLeft=(-0.9, 0.9, -2), LookDownRight=(0.9, 0.9, 2),
).items():
    A[nm] = look(nm, lx, ly, r)

pt = dict(mouth='open', mo=0.3, bl=2, br=2)
A['GestureRight'] = dict(keys=[K(100, 3, pt, rh=(49, -30), rhs='point', rha=90, lx=1), K(520, 0, pt, rh=(50, -30), rhs='point', rha=90, lx=1)])
A['GestureLeft'] = dict(keys=[K(100, 3, pt, lh=(-49, -30), lhs='point', lha=-90, lx=-1), K(520, 0, pt, lh=(-50, -30), lhs='point', lha=-90, lx=-1)])
A['GestureUp'] = dict(keys=[K(100, 3, pt, rh=(42, -74), rhs='point', rha=0, ly=-1), K(520, 0, pt, rh=(42, -76), rhs='point', rha=0, ly=-1)])
A['GestureDown'] = dict(keys=[K(100, 3, pt, rh=(40, 6), rhs='point', rha=180, ly=1), K(520, 0, pt, rh=(40, 8), rhs='point', rha=180, ly=1)])

A['GetAttention'] = dict(keys=[
    K(80, 2, sy=0.88, sx=1.07, lh=(-44, -20), rh=(44, -20), es='wide', bl=5, br=5),
    K(80, 2, 'out', dy=-16, sy=1.1, sx=0.94, lh=(-50, -64), rh=(50, -64), es='wide', bl=6, br=6, mouth='open', mo=0.6, fx='lines', ft=0.1),
    K(70, 2, dy=0, sy=0.88, sx=1.07, lh=(-46, -40), rh=(46, -40), es='wide', bl=5, br=5, mouth='open', mo=0.6, ft=0.4),
    K(80, 2, 'out', dy=-14, sy=1.08, sx=0.95, lh=(-52, -68), rh=(52, -58), es='wide', bl=6, br=6, mouth='open', mo=0.6, ft=0.7),
    K(80, 2, dy=0, sy=0.9, sx=1.06, lh=(-44, -30), rh=(44, -30), es='wide', mouth='open', mo=0.6, ft=1.0),
    K(260, 2, HAPPY, lh=(-50, -60), rh=(50, -60)),
])

C0 = dict(prop='clip', lh=(-37, -26), lhs='grip', pq=-8, pp=0, lx=-0.8, ly=0.2, mouth='flat', tl=-1, tr=-1, rh=(-18, -44), rhs='point', rha=-75)
A['CheckingSomething'] = dict(keys=[
    K(120, 3, C0),
    K(120, 1, {**C0, 'pp': 1, 'ly': 0.6}), K(120, 1, {**C0, 'pp': 2, 'ly': 0.2, 'lx': -0.5}),
    K(120, 1, {**C0, 'pp': 3, 'ly': 0.6, 'lx': -0.8}), K(140, 1, {**C0, 'pp': 4, 'ly': 0.2}),
    K(200, 2, {**C0, 'pp': 4}, HAPPY, es='happy'),
])

TY = dict(prop='keys', lhs='fist', rhs='fist', ly=0.9, mouth='smirk', fx='binary')
A['GetTechy'] = dict(keys=[
    K(100, 3, TY, lh=(-14, -12), rh=(14, -12), ft=0.0, pp=-1, tl=-1, tr=-1),
    *[K(70, 0, TY, lh=(-14 + (i % 3) * 4, -10 - (i % 2) * 2), rh=(14 - (i % 4) * 3, -10 - ((i + 1) % 2) * 2), ft=0.1 + 0.1 * i, pp=(i * 5) % 18, lx=(-1) ** i * 0.3, tl=-1, tr=-1) for i in range(11)],
    K(180, 2, TY, lh=(-14, -12), rh=(14, -12), ft=1.0, pp=-1, es='happy'),
])

WZ = dict(hat='wizard', prop='wand', rh=(44, -36), rhs='grip', **HAPPY)
A['GetWizardy'] = dict(keys=[
    K(80, 2, es='wide', mouth='o', mo=0.3),
    K(100, 2, WZ, snd='ding', pq=40, pp=0.2, fx='burst', ft=0.2),
    K(100, 2, WZ, rh=(46, -58), pq=20, pp=0.8, fx='burst', ft=0.6, fx2='sparkle', ft2=0.1),
    K(100, 2, WZ, rh=(40, -34), pq=55, pp=1.0, fx='sparkle', ft=0.3),
    K(100, 2, WZ, rh=(46, -62), pq=15, pp=1.0, fx='sparkle', ft=0.6),
    K(120, 2, WZ, rh=(44, -36), pq=40, pp=0.6, fx='sparkle', ft=0.9),
    K(120, 2, es='happy', mouth='open', mo=0.6, fx='burst', ft=0.5),
])

PR0 = dict(fx='gear', ft=0.0, mouth='flat', ly=-0.3)
A['Processing'] = dict(loop=(1, 4), keys=[
    K(90, 3, PR0, lab=0.0),
    K(100, 1, {**PR0, 'ft': 0.25, 'shut': 0.8, 'lab': 0.25, 'lx': 0.6}),
    K(100, 1, {**PR0, 'ft': 0.5, 'shut': 0.0, 'lab': 0.5, 'lx': -0.6, 'rot': 0.8}),
    K(100, 1, {**PR0, 'ft': 0.75, 'shut': 0.8, 'lab': 0.8, 'lx': 0.6, 'rot': -0.8}),
    K(100, 1, {**PR0, 'ft': 1.0, 'lab': 0.0}),
])

A['Print'] = dict(keys=[
    K(90, 3, ly=-0.5, mouth='o', mo=0.2, shut=1),
    K(100, 1, snd='seek', ly=-0.7, mouth='o', mo=0.2, shut=1, sheet=0.2, rot=0.8),
    K(100, 1, ly=-0.7, mouth='o', mo=0.2, shut=1, sheet=0.5, rot=-0.8),
    K(100, 1, ly=-0.7, mouth='o', mo=0.2, shut=1, sheet=0.8, rot=0.8),
    K(100, 1, ly=-0.5, mouth='o', mo=0.2, shut=1, sheet=1.0, rot=0),
    K(300, 2, HAPPY, shut=0, sheet=1.0),
])

A['SendMail'] = dict(keys=[
    K(90, 3, prop='mail', rh=(34, -30), rhs='grip', mouth='smile', lx=0.6),
    K(90, 2, rot=-4, prop='mail', rh=(36, -52), rhs='grip', lx=0.8, ly=-0.4, mouth='smile'),
    K(70, 2, 'out', HAPPY, snd='whoosh', rot=5, rh=(48, -62), rhs='open', fx='mail', ft=0.08),
    K(80, 2, HAPPY, rot=2, rh=(48, -62), rhs='open', fx='mail', ft=0.4, lx=0.8, ly=-0.8),
    K(100, 2, HAPPY, rot=0, rh=(48, -62), fx='mail', ft=0.8, lx=0.8, ly=-0.8),
    K(200, 2, HAPPY, fx='mail', ft=1.0),
])

A['Hearing_1'] = dict(keys=[
    K(110, 3, rot=4, rh=(40, -54), rhs='open', lx=0.9, bl=2, br=2, tl=1, tr=1, mouth='o', mo=0.15, fx='waves', ft=0.0),
    K(180, 1, rot=5, rh=(41, -56), lx=0.9, bl=3, br=3, mouth='o', mo=0.15, fx='waves', ft=0.33),
    K(180, 1, rot=4, rh=(40, -54), lx=0.9, bl=2, br=2, mouth='o', mo=0.15, fx='waves', ft=0.66),
    K(180, 1, rot=5, rh=(41, -56), lx=0.9, mouth='smile', fx='waves', ft=0.99),
])
