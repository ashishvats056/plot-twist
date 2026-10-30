import json,sys
t=sys.stdin.read(); i=t.rfind('{"tag"')
if i<0: print(t[-2000:]); sys.exit()
d=json.loads(t[i:])
def ok(k):
    v=d[k]
    if k=='cinema': return v['min_sat'] < v['base_sat']*0.3
    if k=='facepalm': return max(v['diffs']) > 20
    if k=='money': return v['max_green'] > 0.1
    if k in ('vanish','return'): return sum(1 for x in v['diffs'] if x > 2.5) >= 6  # gradual dust over many frames
extra = ''
if 'detector_while_off' in d:
    extra = f" live-switch:{'OK' if not d['detector_while_off'] and d['off_again_green'] < 0.02 else 'FAIL'}"
print(sys.argv[1], 'view=' + str(d.get('viewer')), ' '.join(f"{k}:{'OK' if ok(k) else 'FAIL'}" for k in ['cinema','facepalm','money','vanish','return']), extra.strip(), 'errors', d['errors'])
