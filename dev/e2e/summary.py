import json,sys
t=sys.stdin.read(); i=t.rfind('{"tag"')
if i<0: print(t[-2000:]); sys.exit()
d=json.loads(t[i:])
def ok(k):
    v=d[k]
    if k=='cinema': return v['min_sat'] < v['base_sat']*0.3
    if k=='facepalm':  # a local GIF changes the whole frame; the cartoon shows its white rim; the emoji is yellow
        return max(v['diffs']) > 20 or v.get('max_ring', 0) > 0.6 or (v.get('max_yellow', 0) > 0.02 and v.get('base_yellow', 1) < 0.005)
    if k=='money': return v['max_green'] > 0.1 and v.get('max_edge_green', 1) > 0.05  # notes also over the replaced background
    if k in ('vanish','return'): return sum(1 for x in v['diffs'] if x > 2.5) >= 6  # gradual dust over many frames
extra = ''
if 'detector_while_off' in d:
    extra = f" live-switch:{'OK' if not d['detector_while_off'] and d['off_again_green'] < 0.02 else 'FAIL'}"
if 'has_photo' in d:
    v = d['vanish']['diffs']
    # A jump into the photo shows up as one frame changing far more than its neighbours.
    spikes = [i for i in range(1, len(v) - 1) if v[i] > 3 * max(1.0, (v[i - 1] + v[i + 1]) / 2) and v[i] > 6]
    extra += f" photo-fade:{'OK' if d['has_photo'] and not spikes else 'FAIL'}"
if d.get('mode') == 'bgpic':
    extra += f" meet-bg-fills:{'OK' if d['blue_in_vanished'] > 0.35 else 'FAIL'}(person area {d['blue_in_vanished']:.0%} Meet picture)"
if 'cartoon_ready' in d:
    f = d['facepalm']
    if d['cartoon_ready'] and f['max_ring'] > 0.6: kind = 'cartoon'
    elif not d['cartoon_ready'] and f['max_yellow'] > 0.02 and f['base_yellow'] < 0.005: kind = 'emoji'
    else: kind = f"unclear(ready={d['cartoon_ready']},ring={f['max_ring']},yellow={f['max_yellow']})"
    extra += f" facepalm-kind:{kind}"
print(sys.argv[1], 'view=' + str(d.get('viewer')), ' '.join(f"{k}:{'OK' if ok(k) else 'FAIL'}" for k in ['cinema','facepalm','money','vanish','return']), extra.strip(), 'errors', d['errors'])
