#!/usr/bin/env python3
"""Writes the boilerplate for one Actor from actors/<name>/spec.json:
package.json, Dockerfile, .actor/{actor,input_schema,output_schema,pricing,store,test-input}.json.
Tool code (src/main.js, src/lib.js, tests/) is written by hand. Run: python3 actors/gen.py <name>"""
import json, sys, os

name = sys.argv[1]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
spec = json.load(open(os.path.join(root, 'spec.json')))
os.makedirs(os.path.join(root, '.actor'), exist_ok=True)

def w(rel, obj):
    p = os.path.join(root, rel)
    with open(p, 'w') as f:
        if isinstance(obj, str): f.write(obj)
        else: json.dump(obj, f, indent=2); f.write('\n')

deps = {'apify': '^3.2.0', **spec.get('deps', {})}
w('package.json', {
    'name': name, 'version': '0.1.0', 'private': True, 'type': 'module', 'description': spec['description'],
    'scripts': {'start': 'node src/main.js', 'test': 'node --test tests/*.test.mjs'},
    'dependencies': deps, 'engines': {'node': '>=20'}})
w('Dockerfile', 'FROM apify/actor-node:22\nCOPY package*.json ./\nRUN npm --quiet set progress=false && npm install --omit=dev --omit=optional --no-audit --no-fund\nCOPY . ./\nCMD ["npm", "start", "--silent"]\n')
w('.gitignore', 'node_modules/\nstorage/\n')

fields = spec['view']
w('.actor/actor.json', {
    'actorSpecification': 1, 'name': name, 'title': spec['title'], 'description': spec['description'],
    'version': spec.get('version', '0.1'), 'buildTag': 'latest', 'input': './input_schema.json', 'output': './output_schema.json',
    'dockerfile': '../Dockerfile',
    'storages': {'dataset': {'actorSpecification': 1, 'views': {'overview': {
        'title': spec.get('viewTitle', 'Results'),
        'transformation': {'fields': [f[0] for f in fields]},
        'display': {'component': 'table', 'properties': {f[0]: {'label': f[1], 'format': f[2] if len(f) > 2 else 'text'} for f in fields}}}}}}})
w('.actor/input_schema.json', {'title': spec['title'], 'type': 'object', 'schemaVersion': 1, 'properties': spec['input'], 'required': spec.get('required', [])})
w('.actor/output_schema.json', {'actorOutputSchemaVersion': 1, 'title': spec.get('viewTitle', 'Results'), 'properties': {
    'overview': {'type': 'string', 'title': spec.get('viewTitle', 'Results') + ' (table)', 'template': '{{links.apiDefaultDatasetUrl}}/items?view=overview'},
    'results': {'type': 'string', 'title': 'All fields (JSON)', 'template': '{{links.apiDefaultDatasetUrl}}/items'}}})
w('.actor/pricing.json', spec['pricing'])
assert len(spec['title']) <= 63, 'title over 63 characters'
assert len(spec['store']['seoTitle']) <= 60, 'seoTitle too long'
assert len(spec['store']['seoDescription']) <= 160, 'seoDescription too long'
w('.actor/store.json', spec['store'])
w('.actor/test-input.json', spec['testInput'])
os.makedirs(os.path.join(root, 'src', 'shared'), exist_ok=True)
os.makedirs(os.path.join(root, 'tests'), exist_ok=True)
print('generated', name)
