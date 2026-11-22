"""Builds the Floppy agent for clippyjs.

Writes agent.json, map.png and sounds.json (same file names clippyjs and the app already use).
Usage (from the repo root):
    python scripts/floppy/build.py                  # writes public/clippy/
    python scripts/floppy/build.py --preview DIR    # also writes contact sheets to DIR
Requires Python 3, Pillow and numpy.
"""
import argparse
import hashlib
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image

import sounds
from anims import A, build
from character import REST, render_frame
from engine import H, W


def key(pose):
    def norm(v):
        if isinstance(v, float):
            return round(v, 2)
        if isinstance(v, tuple):
            return tuple(round(x, 2) for x in v)
        return v

    return hashlib.md5(repr(sorted((k, norm(v)) for k, v in pose.items())).encode()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='public/clippy')
    ap.add_argument('--preview')
    args = ap.parse_args()

    cache, images, order = {}, [], []

    def cell(pose):
        k = key(pose)
        if k not in cache:
            cache[k] = len(images)
            images.append(render_frame(pose))
        return cache[k]

    cell(dict(REST))  # cell 0 is always the rest pose, at (0, 0)

    agent_anims, built = {}, {}
    for name, spec in A.items():
        frames, loop = build(spec)
        built[name] = [(pose, cell(pose)) for pose, _, _ in frames]
        out = []
        for i, (pose, dur, snd) in enumerate(frames):
            out.append({'duration': dur, 'images': [[built[name][i][1], 0]]})
            if snd:
                out[-1]['sound'] = snd
        if loop:
            start, end, exit_ = loop
            out[end]['branching'] = {'branches': [{'frameIndex': start, 'weight': 100}]}
            out[end]['exitBranch'] = exit_
        agent_anims[name] = {'frames': out}

    cols = 24
    rows = math.ceil(len(images) / cols)
    sheet = Image.new('RGBA', (cols * W, rows * H), (0, 0, 0, 0))
    for i, im in enumerate(images):
        sheet.paste(im, ((i % cols) * W, (i // cols) * H))
    for anim in agent_anims.values():
        for fr in anim['frames']:
            idx = fr['images'][0][0]
            fr['images'] = [[(idx % cols) * W, (idx // cols) * H]]

    snd = sounds.make()
    agent = {'overlayCount': 1, 'sounds': sorted(snd), 'framesize': [W, H], 'animations': agent_anims}

    os.makedirs(args.out, exist_ok=True)
    sheet.save(os.path.join(args.out, 'map.png'), optimize=True)
    with open(os.path.join(args.out, 'agent.json'), 'w') as f:
        json.dump(agent, f, separators=(',', ':'))
    with open(os.path.join(args.out, 'sounds.json'), 'w') as f:
        json.dump(snd, f, separators=(',', ':'))
    print(f'{len(agent_anims)} animations, {len(images)} unique frames, sheet {sheet.size}, '
          f'{os.path.getsize(os.path.join(args.out, "map.png")) // 1024} KB')

    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
        names = list(built)
        per = 5
        for g in range(0, len(names), per):
            grp = names[g : g + per]
            per_row = 12
            im = Image.new('RGBA', (per_row * W, len(grp) * H), (0, 128, 128, 255))
            for r, n in enumerate(grp):
                seq = built[n]
                pick = seq if len(seq) <= per_row else [seq[round(i * (len(seq) - 1) / (per_row - 1))] for i in range(per_row)]
                for c, (_, ci) in enumerate(pick):
                    im.alpha_composite(images[ci], (c * W, r * H))
            im.save(os.path.join(args.preview, f'anims_{g // per:02d}.png'))
            print(f'anims_{g // per:02d}:', ', '.join(grp))


if __name__ == '__main__':
    main()
