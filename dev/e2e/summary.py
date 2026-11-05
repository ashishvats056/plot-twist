import json,sys
t=sys.stdin.read(); i=t.rfind('{"tag"')
if i<0: print(t[-2000:]); sys.exit()
d=json.loads(t[i:])
# the cartoon sticker's light-blue backdrop filling its disc (survives a blurry, low-res frame)
sticker = lambda v: v.get('max_disc', 0) > 0.5 and v.get('base_disc', 1) < 0.1
def ok(k):
    v=d[k]
    if k=='cinema': return v['min_sat'] < v['base_sat']*0.3
    if k=='facepalm':  # a local GIF changes the whole frame; the cartoon shows its white rim; the emoji is yellow; your own test picture is magenta
        return max(v['diffs']) > 20 or v.get('max_ring', 0) > 0.6 or sticker(v) or (v.get('max_yellow', 0) > 0.02 and v.get('base_yellow', 1) < 0.005) \
            or (v.get('max_magenta', 0) > 0.3 and v.get('base_magenta', 1) < 0.01)
    if k=='money': return v['max_green'] > 0.1 and v.get('max_edge_green', 1) > 0.05  # notes also over the replaced background
    # The dust is gradual: 10% to 90% of the motion takes about a second or
    # more (an instant cut is all in one frame: 0 ms). Measured on every frame
    # the browser received, so it doesn't depend on the frame rate.
    # A starved machine (no GPU) can go most of a second without a frame; then
    # how gradual it was can't be seen, and only the outcome is checked: the
    # picture changed a lot, and the extension reports vanished / visible.
    if k in ('vanish','return'):
        if few(k): return v['rise']['total'] > 15 and d.get('mode_after_' + k, '') == ('vanished' if k == 'vanish' else 'visible')
        return v['rise']['total'] > 15 and v['rise']['ms'] >= 500
few = lambda k: d[k]['rise'].get('gap', 0) > 400
extra = ''
# frames the viewed video actually showed during each effect (low = starved machine)
extra += ' frames:' + '/'.join(str(d[k].get('frames', '?')) for k in ['cinema','facepalm','money','vanish','return'])
if any(few(k) for k in ('vanish', 'return')):  # judged by the outcome only (see above)
    extra += ' few-frames:' + ','.join(k for k in ('vanish', 'return') if few(k))
if any(few(k) or not ok(k) for k in ('vanish', 'return')):  # the numbers behind the call, for the log
    extra += ' rise:' + ','.join(f"{k}={d[k]['rise'].get('ms')}ms/{d[k]['rise'].get('total')}/gap{d[k]['rise'].get('gap')}/{d.get('mode_after_' + k)}" for k in ('vanish', 'return'))
if d.get('stalled'):  # overlays shown again because the camera feed paused (see regress.py)
    extra += ' stalled-again:' + ','.join(d['stalled'])
if 'detector_while_off' in d:
    extra += f" live-switch:{'OK' if not d['detector_while_off'] and d['off_again_green'] < 0.02 else 'FAIL'}"
if 'has_photo' in d:
    v = d['vanish']['diffs']
    # A jump into the photo shows up as one frame changing far more than its neighbours.
    spikes = [i for i in range(1, len(v) - 1) if v[i] > 3 * max(1.0, (v[i - 1] + v[i + 1]) / 2) and v[i] > 6]
    extra += f" photo-fade:{'OK' if d['has_photo'] and not spikes else 'FAIL'}"
    if 'photo_after_restart' in d:  # the photo survives camera off/on and a reload; ✕ deletes it
        kept = d['photo_after_restart'] and d.get('photo_after_reload') and d.get('photo_kept_after_clear') == 0
        extra += f" photo-kept:{'OK' if kept else 'FAIL'}"
if d.get('mode') == 'bgpic':
    extra += f" meet-bg-fills:{'OK' if d['blue_in_vanished'] > 0.35 else 'FAIL'}(person area {d['blue_in_vanished']:.0%} Meet picture)"
if 'cartoon_ready' in d:
    f = d['facepalm']
    if f.get('max_magenta', 0) > 0.3 and f.get('base_magenta', 1) < 0.01: kind = 'custom'
    elif d['cartoon_ready'] and (f['max_ring'] > 0.6 or sticker(f)): kind = 'cartoon'
    elif not d['cartoon_ready'] and f['max_yellow'] > 0.02 and f['base_yellow'] < 0.005: kind = 'emoji'
    else: kind = f"unclear(ready={d['cartoon_ready']},ring={f['max_ring']},disc={f.get('max_disc')},frames={f.get('frames')},gap={f.get('rise', {}).get('gap')},yellow={f['max_yellow']})"
    extra += f" facepalm-kind:{kind}"
print(sys.argv[1], 'view=' + str(d.get('viewer')), ' '.join(f"{k}:{'OK' if ok(k) else 'FAIL'}" for k in ['cinema','facepalm','money','vanish','return']), extra.strip(), 'errors', d['errors'])
