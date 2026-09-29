// Rule sets the backtest compares. Each is the production v8.6 policy with a
// few trade-shape settings changed (see ACTIVE_LEADER_RISK_POLICY in
// src/leader-capacity.ts); everything else — discovery, scoring, sizing, the
// daily risk governor — is the real production code.
import {ACTIVE_LEADER_RISK_POLICY} from '../src/leader-capacity.ts';

const v86 = ACTIVE_LEADER_RISK_POLICY;
const flat = {flat_minutes_before_close: 10, entry_cutoff_minutes_before_close: 30};
const make = (id, label, changes) => ({id, label, changes, policy: Object.freeze({...v86, ...changes})});

export const VARIANTS = [
  make('v86_baseline', 'Today\'s rules (v8.6): 5% stop, 12-hour time exit, ladder to +200%, holds overnight', {}),
  make('flat_close', 'v8.6, but no new buys in the last 30 minutes and everything sold 10 minutes before the close', flat),
  make('no_chase_10_flat', 'Flat by the close, and only buy stocks up 10% or less on the day', {...flat, max_entry_day_change_pct: 10}),
  make('no_chase_20_flat', 'Flat by the close, and only buy stocks up 20% or less on the day', {...flat, max_entry_day_change_pct: 20}),
  make('trail_flat', 'Flat by the close; once up 6%, sell if it falls 4% from its best price', {...flat, trail_activate_pct: 0.06, trail_pct: 0.04}),
  make('tp15_flat', 'Flat by the close; take the whole profit at +15%', {...flat, take_profit_pct: 0.15}),
  make('hold60_flat', 'Flat by the close; sell after 60 minutes at most', {...flat, equity_max_hold_minutes: 60}),
  make('stop3_flat', 'Flat by the close; 3% stop instead of 5%', {...flat, equity_stop_loss_pct: 0.03}),
  make('stop8_flat', 'Flat by the close; 8% stop instead of 5%', {...flat, equity_stop_loss_pct: 0.08}),
];

export function pickVariants(spec = 'all') {
  if (!spec || spec === 'all') return VARIANTS;
  const ids = spec.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = ids.filter(id => !VARIANTS.some(v => v.id === id));
  if (unknown.length) throw new Error('unknown variant(s): ' + unknown.join(', ') + '. Known: ' + VARIANTS.map(v => v.id).join(', '));
  return VARIANTS.filter(v => ids.includes(v.id));
}
