// Gzipped JSON files under the backtest data directory.
import {gzipSync, gunzipSync} from 'node:zlib';
import {readFileSync, writeFileSync, existsSync, mkdirSync, renameSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {threadId} from 'node:worker_threads';

export class Store {
  constructor(root) { this.root = root; mkdirSync(root, {recursive: true}); }
  path(name) { return join(this.root, name); }
  has(name) { return existsSync(this.path(name)); }
  read(name, fallback = undefined) {
    const p = this.path(name);
    if (!existsSync(p)) { if (fallback !== undefined) return fallback; throw new Error('missing data file ' + name); }
    const raw = readFileSync(p);
    return JSON.parse((name.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
  }
  // Atomic write: a crash never leaves a half-written file that looks complete.
  write(name, value) {
    const p = this.path(name), tmp = `${p}.${process.pid}.${threadId}.${Math.random().toString(36).slice(2)}.tmp`;
    mkdirSync(dirname(p), {recursive: true});
    const text = Buffer.from(JSON.stringify(value));
    writeFileSync(tmp, name.endsWith('.gz') ? gzipSync(text, {level: 6}) : text);
    renameSync(tmp, p);
    return p;
  }
}
