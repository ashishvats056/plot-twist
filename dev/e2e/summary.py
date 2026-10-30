import json,sys
t=sys.stdin.read(); i=t.rfind('{"tag"')
if i<0: print(t[-2000:]); sys.exit()
d=json.loads(t[i:])
def ok(k):
    v=d[k]
    if k=='cinema': return v['min_sat'] < v['base_sat']*0.3
    if k=='facepalm': return max(v['diffs']) > 20
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
print(sys.argv[1], 'view=' + str(d.get('viewer')), ' '.join(f"{k}:{'OK' if ok(k) else 'FAIL'}" for k in ['cinema','facepalm','money','vanish','return']), extra.strip(), 'errors', d['errors'])
