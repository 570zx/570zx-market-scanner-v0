#!/usr/bin/env python3
"""Configure one Actor on Apify after it is pushed: pricing, Store details, a real test run, visibility.
Usage: ship.py <actor-folder>. Reads .actor/{actor,pricing,store,test-input}.json. Never prints the token.
Goes public only when PUBLIC=true AND the pricing is confirmed AND the test run delivered at least one ok item."""
import json, os, sys, time, urllib.request, urllib.error

API = 'https://api.apify.com/v2'
TOKEN = os.environ['APIFY_TOKEN']
folder = sys.argv[1]
base = os.path.join(os.path.dirname(os.path.abspath(__file__)), folder, '.actor')
load = lambda n: json.load(open(os.path.join(base, n)))
name = load('actor.json')['name']
pricing, store, test_input = load('pricing.json'), load('store.json'), load('test-input.json')

def call(method, path, body=None, timeout=60):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {'error': {'message': raw[:300].decode('utf-8', 'replace')}}

user = call('GET', '/users/me')[1]['data']['username']
act = f'/acts/{user}~{name}'
print(f'actor {user}/{name}')

events = {'apify-actor-start': {'eventTitle': 'Actor start', 'eventDescription': 'Charged once when a run starts.', 'eventPriceUsd': 0.00005}}
for k, v in pricing['events'].items():
    events[k] = {'eventTitle': v['title'], 'eventDescription': v['description'], 'eventPriceUsd': v['price']}
st, cur = call('GET', act)
existing = (cur.get('data') or {}).get('pricingInfos') or []
same = existing and json.dumps(existing[-1].get('pricingPerEvent', {}).get('actorChargeEvents', {}), sort_keys=True) == json.dumps(events, sort_keys=True)
body = {'categories': store['categories'], 'seoTitle': store['seoTitle'], 'seoDescription': store['seoDescription']}
if not same:
    body['pricingInfos'] = [{'pricingModel': 'PAY_PER_EVENT', 'pricingPerEvent': {'actorChargeEvents': events}}]
st, r = call('PUT', act, body)
print('pricing + store details:', st, 'unchanged pricing kept' if same else '', json.dumps(r.get('error')) if r.get('error') else 'ok')
st, cur = call('GET', act)
d = cur.get('data') or {}
pi = d.get('pricingInfos') or []
priced = bool(pi) and all(k in json.dumps(pi[-1]) for k in pricing['events'])
print('pricing confirmed:', priced, {k: v['price'] for k, v in pricing['events'].items()})

st, run = call('POST', f'{act}/runs?memory=512&timeout=300', test_input)
rid = (run.get('data') or {}).get('id')
status, info = None, {}
for _ in range(60):
    time.sleep(5)
    st, info = call('GET', f'/actor-runs/{rid}')
    status = (info.get('data') or {}).get('status')
    if status in ('SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'): break
dd = info.get('data') or {}
st, items = call('GET', f"/datasets/{dd.get('defaultDatasetId')}/items?limit=50")
items = items if isinstance(items, list) else []
ok = [i for i in items if i.get('status') == 'ok']
print(f"test run: {status}, {dd.get('statusMessage')}, secs {(dd.get('stats') or {}).get('runTimeSecs')}, platform cost ${dd.get('usageTotalUsd')}, items {len(items)}, ok {len(ok)}")
for i in items[:8]:
    s = json.dumps(i, ensure_ascii=False)
    print('  ', s[:400] + (' …' if len(s) > 400 else ''))

if os.environ.get('PUBLIC') == 'true':
    if not (priced and status == 'SUCCEEDED' and ok):
        print('NOT made public: needs confirmed pricing and a successful test run with at least one ok item.')
        sys.exit(1)
    st, r = call('PUT', act, {'isPublic': True})
    print('public:', st, json.dumps(r.get('error')) if r.get('error') else (r.get('data') or {}).get('isPublic'))
    if st >= 300: sys.exit(1)
