#!/usr/bin/env python3
"""Set pay-per-event pricing, categories and visibility for the Actor via the Apify API.
Never prints the token. Stops before making the Actor public if pricing did not stick."""
import json, os, urllib.request, urllib.error

API = 'https://api.apify.com/v2'
TOKEN = os.environ['APIFY_TOKEN']
NAME = 'vehicle-safety-intel'

def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

user = call('GET', '/users/me')[1]['data']['username']
act = f'/acts/{user}~{NAME}'
st, cur = call('GET', act)
print(f'# Actor configure\nuser {user}, get actor: {st}')
d = cur.get('data', {})
print('current: isPublic', d.get('isPublic'), 'categories', d.get('categories'), 'pricingInfos', json.dumps(d.get('pricingInfos')))

pricing = [{
    'pricingModel': 'PAY_PER_EVENT',
    'pricingPerEvent': {'actorChargeEvents': {
        'apify-actor-start': {'eventTitle': 'Actor start', 'eventDescription': 'Charged once when a run starts.', 'eventPriceUsd': 0.00005},
        'vehicle-report': {'eventTitle': 'Vehicle report', 'eventDescription': 'One decoded VIN with specs, recalls, complaints and crash ratings. Invalid or undecodable VINs are free.', 'eventPriceUsd': 0.01},
    }},
}]
st, r = call('PUT', act, {'pricingInfos': pricing, 'categories': ['AUTOMATION', 'DEVELOPER_TOOLS'],
                          'seoTitle': 'VIN Decoder API with Recalls, Complaints and Crash Ratings (NHTSA)',
                          'seoDescription': 'Decode VINs in bulk and get NHTSA safety recalls, owner complaints and 5-star crash ratings. Pay per vehicle, invalid VINs free.'})
print(f'\nset pricing/categories: HTTP {st}')
print(json.dumps(r.get('error') or {k: r.get('data', {}).get(k) for k in ['categories', 'pricingInfos']}, indent=1)[:2500])

st, cur = call('GET', act)
pi = cur.get('data', {}).get('pricingInfos') or []
priced = any(p.get('pricingModel') == 'PAY_PER_EVENT' and 'vehicle-report' in json.dumps(p) for p in pi)
print('\npricing confirmed:', priced)

if os.environ.get('MAKE_PUBLIC') == 'true':
    if not priced:
        print('NOT making public: pricing is not set, it would be listed for free.')
    else:
        st, r = call('PUT', act, {'isPublic': True})
        print(f'make public: HTTP {st}', json.dumps(r.get('error') or {'isPublic': r.get('data', {}).get('isPublic')}))
