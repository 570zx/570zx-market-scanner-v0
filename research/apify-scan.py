#!/usr/bin/env python3
"""Market research for the Actor business. Runs in GitHub Actions (open internet).

1. Downloads the public Apify Store catalog (public API, no token) with usage stats.
2. Downloads a short list of reference pages (Apify terms, docs, write-ups) as text.

Stdlib only. Writes to ./out. The workflow encrypts ./out before publishing it,
because the repository is public and the pages are other people's content.
"""
import json, os, sys, time, urllib.request, urllib.error
from html.parser import HTMLParser

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
UA = 'Mozilla/5.0 (compatible; 570zx-research/1.0; +https://github.com/570zx)'
os.makedirs(os.path.join(OUT, 'pages'), exist_ok=True)


def get(url, tries=4, timeout=60):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 401, 403, 404, 410):
                return e.code, e.read() if hasattr(e, 'read') else b''
        except Exception as e:  # network hiccup
            last = e
        time.sleep(2 * (i + 1))
    return 0, str(last).encode()


def store_catalog():
    items, offset, limit, total = [], 0, 1000, None
    while True:
        st, body = get(f'https://api.apify.com/v2/store?limit={limit}&offset={offset}')
        if st != 200:
            print(f'store page offset={offset} status={st}', file=sys.stderr)
            break
        data = json.loads(body)['data']
        total = data.get('total', total)
        batch = data.get('items', [])
        items.extend(batch)
        print(f'store offset={offset} got={len(batch)} total={total}')
        if not batch or len(items) >= (total or 0):
            break
        offset += len(batch)
        time.sleep(1)
    with open(os.path.join(OUT, 'store.json'), 'w') as f:
        json.dump({'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'total': total, 'items': items}, f)
    return len(items)


class Text(HTMLParser):
    SKIP = {'script', 'style', 'noscript', 'svg', 'nav', 'footer', 'header', 'form'}
    BLOCK = {'p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'table', 'pre', 'blockquote'}

    def __init__(self):
        super().__init__(); self.parts = []; self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP: self.skip += 1
        elif tag in self.BLOCK: self.parts.append('\n')
        if tag in ('h1', 'h2', 'h3', 'h4'): self.parts.append('#' * int(tag[1]) + ' ')
        if tag == 'li': self.parts.append('- ')

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip: self.skip -= 1
        elif tag in self.BLOCK: self.parts.append('\n')

    def handle_data(self, data):
        if not self.skip: self.parts.append(data)

    def text(self):
        lines = [' '.join(l.split()) for l in ''.join(self.parts).split('\n')]
        out, blank = [], 0
        for l in lines:
            if l: out.append(l); blank = 0
            elif not blank: out.append(''); blank = 1
        return '\n'.join(out).strip()


def pages(urls):
    index = []
    for i, url in enumerate(urls):
        st, body = get(url)
        raw = body.decode('utf-8', 'replace')
        is_md = url.endswith('.md') or url.endswith('.txt') or raw.lstrip().startswith('#')
        if st == 200 and not is_md:
            p = Text(); p.feed(raw); txt = p.text()
        else:
            txt = raw
        name = f'{i:02d}.txt'
        with open(os.path.join(OUT, 'pages', name), 'w') as f:
            f.write(f'URL: {url}\nSTATUS: {st}\n\n{txt}')
        index.append({'file': name, 'url': url, 'status': st, 'chars': len(txt)})
        print(f'{st} {len(txt):>7} {url}')
        time.sleep(1)
    with open(os.path.join(OUT, 'pages', 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)


if __name__ == '__main__':
    urls = [l.strip() for l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'urls.txt')) if l.strip() and not l.startswith('#')]
    n = store_catalog()
    print(f'catalog items: {n}')
    pages(urls)
