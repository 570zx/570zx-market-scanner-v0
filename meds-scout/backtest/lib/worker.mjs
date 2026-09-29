// Worker thread: replays one rule set over the dataset and posts the result.
import {parentPort, workerData} from 'node:worker_threads';
import {replayVariant} from './replay.mjs';
import {Store} from './store.mjs';
import {Alpaca} from './alpaca.mjs';
import {ensureSymbols} from './dataset.mjs';
import {syntheticDays} from './synthetic.mjs';
import {pickVariants} from '../variants.mjs';

const {variantId, dates, dataDir, synthetic, spreadModel, rpm, asof} = workerData;
const post = message => parentPort.postMessage(message);
try {
  const variant = pickVariants(variantId)[0];
  let loadDay, ensureHeld;
  if (synthetic) {
    const days = new Map(syntheticDays(synthetic.first, synthetic.days, synthetic.options).map(d => [d.date, d]));
    loadDay = date => ({day: days.get(date), extra: null});
  } else {
    const store = new Store(dataDir);
    const key = process.env.ALPACA_API_KEY, secret = process.env.ALPACA_API_SECRET;
    const alpaca = key && secret ? new Alpaca({key, secret, rpm, log: m => post({log: m})}) : null;
    loadDay = date => ({day: store.read(`days/${date}.json.gz`), extra: store.read(`days/${date}.extra.json.gz`, null)});
    ensureHeld = (date, symbols) => ensureSymbols(alpaca, store, {asof}, date, symbols);
  }
  const run = await replayVariant({variant, dates, loadDay, ensureHeld, spreadModel, log: m => post({log: m})});
  post({done: run});
} catch (error) {
  post({error: error?.stack ?? String(error)});
}
