#!/usr/bin/env python3
"""Set only Store details (categories, SEO title, SEO description) for already-published Actors.
Usage: store-details.py <folder> [<folder> ...]. Reads .actor/{actor,store}.json. No pricing or visibility changes."""
import json, os, sys, urllib.request, urllib.error

API = 'https://api.apify.com/v2'
TOKEN = os.environ['APIFY_TOKEN']
HERE = os.path.dirname(os.path.abspath(__file__))

def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {'error': {'message': raw[:300].decode('utf-8', 'replace')}}

user = call('GET', '/users/me')[1]['data']['username']
print('user', user)
for folder in sys.argv[1:]:
    base = os.path.join(HERE, folder, '.actor')
    name = json.load(open(os.path.join(base, 'actor.json')))['name']
    store = json.load(open(os.path.join(base, 'store.json')))
    body = {k: store[k] for k in ('categories', 'seoTitle', 'seoDescription')}
    st, r = call('PUT', f'/acts/{user}~{name}', body)
    d = r.get('data') or {}
    print(f'{name}: HTTP {st}', json.dumps(r.get('error')) if r.get('error') else f"categories {d.get('categories')} seoTitle {d.get('seoTitle')!r} public {d.get('isPublic')}")
