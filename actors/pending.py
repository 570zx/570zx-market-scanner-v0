#!/usr/bin/env python3
"""Print the Actors (folders) that are not yet public, in publish-order.txt order, then any others.
Also writes STATUS.md (all Actors and whether they are public) to the path in $STATUS."""
import json, os, glob, urllib.request, urllib.error
API = 'https://api.apify.com/v2'
H = {'Authorization': f"Bearer {os.environ['APIFY_TOKEN']}"}
here = os.path.dirname(os.path.abspath(__file__))
def get(path):
    try:
        with urllib.request.urlopen(urllib.request.Request(API + path, headers=H), timeout=60) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e: return {'error': e.code}
user = get('/users/me')['data']['username']
folders = sorted(os.path.basename(os.path.dirname(os.path.dirname(p))) for p in glob.glob(os.path.join(here, '*/.actor/actor.json')))
order = [l.strip() for l in open(os.path.join(here, 'publish-order.txt')) if l.strip() and not l.startswith('#')] if os.path.exists(os.path.join(here, 'publish-order.txt')) else []
ranked = [f for f in order if f in folders] + [f for f in folders if f not in order]
rows, pending = [], []
for f in ranked:
    name = json.load(open(os.path.join(here, f, '.actor', 'actor.json')))['name']
    d = get(f'/acts/{user}~{name}').get('data') or {}
    public = bool(d.get('isPublic'))
    ready = os.path.exists(os.path.join(here, f, 'README.md'))
    rows.append(f"| {f} | {'yes' if public else 'no'} | {'built' if d else 'not built'} | {'' if ready else 'no README'} |")
    if not public and ready: pending.append(f)
if os.environ.get('STATUS'):
    with open(os.environ['STATUS'], 'w') as fh:
        fh.write(f"# Actor status ({user})\n\n| Actor | Public | On Apify | Note |\n|---|---|---|---|\n" + '\n'.join(rows) + '\n')
print(' '.join(pending))
