#!/usr/bin/env python3
"""Government small-award scan. Runs in GitHub Actions (open internet).

Uses the public USAspending.gov API (no key, public data) to answer: what small federal
contracts are bought, in which categories, at what size, from how many vendors, and how
concentrated the winners are. Writes report.md and raw.json to ./gov-out.
Stdlib only. Nothing here logs in, registers, or bids on anything.
"""
import json, os, sys, time, urllib.request, urllib.error
from datetime import date

BASE = 'https://api.usaspending.gov/api/v2'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'gov-out')
os.makedirs(OUT, exist_ok=True)
START, END = '2025-07-01', '2026-06-30'  # 12 full months that have settled in the data
ERRORS = []


def post(path, body, tries=4):
    data = json.dumps(body).encode()
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type': 'application/json', 'User-Agent': '570zx-research/1.0'})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            last = f'HTTP {e.code} {e.read()[:300]!r}'
            if e.code in (400, 404, 422):
                break
        except Exception as e:
            last = str(e)
        time.sleep(3 * (i + 1))
    ERRORS.append(f'{path}: {last}')
    return None


def filters(lo, hi, naics=None, state=None, setaside=None):
    f = {'time_period': [{'start_date': START, 'end_date': END}], 'award_type_codes': ['A', 'B', 'C', 'D'],
         'award_amounts': [{'lower_bound': lo, 'upper_bound': hi}]}
    if naics:
        f['naics_codes'] = {'require': [naics]} if isinstance(naics, str) else {'require': list(naics)}
    if state:
        f['place_of_performance_locations'] = [{'country': 'USA', 'state': state}]
    if setaside:
        f['type_set_asides'] = setaside
    return f


def count(f):
    r = post('/search/spending_by_award_count/', {'filters': f})
    return (r or {}).get('results', {}).get('contracts')


def total(f):
    r = post('/search/spending_over_time/', {'group': 'fiscal_year', 'filters': f})
    if not r:
        return None
    return round(sum(x.get('aggregated_amount', 0) for x in r.get('results', [])))


def category(cat, f, limit=15):
    r = post(f'/search/spending_by_category/{cat}/', {'filters': f, 'limit': limit, 'page': 1})
    return (r or {}).get('results', [])


def sample(f, n=25):
    fields = ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Start Date', 'Description', 'NAICS', 'PSC']
    r = post('/search/spending_by_award/', {'filters': f, 'fields': fields, 'limit': n, 'page': 1, 'sort': 'Award Amount', 'order': 'desc'})
    return (r or {}).get('results', [])


DIGITAL = {
    '541511': 'Custom software programming', '541512': 'Computer systems design', '541519': 'Other computer related services',
    '518210': 'Data processing and hosting', '541690': 'Other scientific and technical consulting', '541910': 'Marketing research',
    '541611': 'Administrative management consulting', '541430': 'Graphic design', '541810': 'Advertising agencies',
    '541990': 'Other professional services', '561410': 'Document preparation', '541370': 'Surveying and mapping (geospatial)',
    '541618': 'Other management consulting', '611430': 'Professional and management training', '561499': 'Other business support',
    '519130': 'Internet publishing and web search', '511210': 'Software publishers',
}


def money(x):
    return '—' if x is None else f'${x:,.0f}'


def main():
    raw = {'period': [START, END], 'errors': ERRORS}
    md = [f'# Government small-award scan ({date.today().isoformat()})', '',
          f'Source: USAspending.gov public API. Federal contract awards with start dates {START} to {END}.',
          'Micro-purchases under the card threshold are often not reported individually, so every count below undercounts real buying.', '']

    bands = {'micro (up to $15,000)': (1, 15000), 'simplified ($15,000–$350,000)': (15000, 350000)}
    md += ['## How much is bought, by size', '', '| Band | Awards | Total obligated | Average |', '| --- | ---: | ---: | ---: |']
    raw['bands'] = {}
    for name, (lo, hi) in bands.items():
        f = filters(lo, hi)
        c, t = count(f), total(f)
        raw['bands'][name] = {'count': c, 'total': t}
        md.append(f'| {name} | {c if c is not None else "—"} | {money(t)} | {money(t / c) if c and t else "—"} |')
    f_nc = filters(1, 15000, state='NC')
    c, t = count(f_nc), total(f_nc)
    raw['nc_micro'] = {'count': c, 'total': t}
    md += ['', f'North Carolina micro awards (place of performance NC): {c} awards, {money(t)}.', '']

    md += ['## Digital work I could deliver (micro awards up to $15,000)', '',
           '| NAICS | Service | Awards | Total | Average |', '| --- | --- | ---: | ---: | ---: |']
    raw['digital'] = {}
    rows = []
    for code, label in DIGITAL.items():
        f = filters(1, 15000, naics=code)
        c, t = count(f), total(f)
        raw['digital'][code] = {'label': label, 'count': c, 'total': t}
        rows.append((c or 0, code, label, c, t))
    for _, code, label, c, t in sorted(rows, reverse=True):
        md.append(f'| {code} | {label} | {c if c is not None else "—"} | {money(t)} | {money(t / c) if c and t else "—"} |')
    all_digital = filters(1, 15000, naics=list(DIGITAL))
    dc, dt = count(all_digital), total(all_digital)
    raw['digital_all'] = {'count': dc, 'total': dt}
    md += ['', f'All digital categories together: {dc} awards, {money(dt)}.', '']

    md += ['## Who wins the digital micro awards', '']
    rec = category('recipient', all_digital, 100)
    raw['digital_recipients'] = rec
    if rec and dt:
        top10 = sum(x.get('amount', 0) for x in rec[:10])
        md.append(f'The top 10 vendors took {money(top10)}, which is {top10 / dt:.0%} of the total. Top 10:')
        md.append('')
        for x in rec[:10]:
            md.append(f'- {x.get("name")}: {money(x.get("amount"))}')
        md.append('')
        md.append(f'Vendors in the top-100 list: {len(rec)}. The 100th vendor won {money(rec[-1].get("amount"))}; the 50th won {money(rec[min(49, len(rec)-1)].get("amount"))}.')
        md.append('')
    md += ['## Which agencies buy it', '']
    ag = category('awarding_agency', all_digital, 10)
    raw['digital_agencies'] = ag
    for x in ag:
        md.append(f'- {x.get("name")}: {money(x.get("amount"))}')
    md += ['', '## What the awards actually say (largest digital micro awards, sample)', '']
    s = sample(all_digital, 25)
    raw['digital_sample'] = s
    for r in s:
        md.append(f'- {money(r.get("Award Amount"))} · {r.get("Awarding Agency")} · {r.get("NAICS") if isinstance(r.get("NAICS"), str) else (r.get("NAICS") or {}).get("description")} · {(r.get("Description") or "")[:140]}')

    nc_dig = filters(1, 15000, naics=list(DIGITAL), state='NC')
    ncc, nct = count(nc_dig), total(nc_dig)
    raw['nc_digital'] = {'count': ncc, 'total': nct}
    md += ['', f'North Carolina digital micro awards: {ncc} awards, {money(nct)}.', '']
    ns = sample(nc_dig, 15)
    raw['nc_digital_sample'] = ns
    for r in ns:
        md.append(f'- {money(r.get("Award Amount"))} · {r.get("Awarding Agency")} · {(r.get("Description") or "")[:140]}')
    md += ['', '## Goods: what product categories dominate micro awards', '']
    psc = category('psc', filters(1, 15000), 15)
    raw['psc'] = psc
    for x in psc:
        md.append(f'- {x.get("code")} {x.get("name")}: {money(x.get("amount"))}')
    md += ['', '## Top awarding agencies for all micro awards', '']
    ag2 = category('awarding_agency', filters(1, 15000), 10)
    raw['agencies'] = ag2
    for x in ag2:
        md.append(f'- {x.get("name")}: {money(x.get("amount"))}')

    if ERRORS:
        md += ['', '## Request problems', ''] + [f'- {e}' for e in ERRORS]
    with open(os.path.join(OUT, 'report.md'), 'w') as fh:
        fh.write('\n'.join(md) + '\n')
    with open(os.path.join(OUT, 'raw.json'), 'w') as fh:
        json.dump(raw, fh, indent=1)
    print('\n'.join(md))
    return 0


if __name__ == '__main__':
    sys.exit(main())
