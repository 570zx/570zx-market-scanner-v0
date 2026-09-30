// NHTSA public-data client and report builder. No Apify imports: pure logic, easy to test.
// Data: vPIC (VIN decoding), NHTSA recalls, complaints and NCAP safety ratings APIs (US government, public).

const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';
const API = 'https://api.nhtsa.gov';

// A VIN is 17 characters, digits and capital letters except I, O and Q.
export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(raw) {
  return String(raw ?? '').replace(/[\s-]/g, '').toUpperCase();
}

const TRANSLIT = {A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// North American check digit (position 9). Cars built elsewhere may not follow it, so a mismatch is a warning, not an error.
export function checkDigitOk(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    const v = /\d/.test(ch) ? Number(ch) : TRANSLIT[ch];
    sum += v * WEIGHTS[i];
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? 'X' : String(r));
}

const clean = v => {
  const s = typeof v === 'string' ? v.trim() : v;
  return s === '' || s == null ? null : s;
};
const num = v => {
  const n = Number(clean(v));
  return Number.isFinite(n) && clean(v) != null ? n : null;
};

export class NhtsaClient {
  constructor({fetchImpl = fetch, retries = 3, baseDelayMs = 500, timeoutMs = 30000, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
    Object.assign(this, {fetchImpl, retries, baseDelayMs, timeoutMs, sleep});
  }

  async getJson(url, {emptyOn400 = false} = {}) {
    let last;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchImpl(url, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(this.timeoutMs)});
        if (res.status === 404 || (emptyOn400 && res.status === 400)) return {notFound: true};
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        // NHTSA answers some empty lookups with an empty body.
        return text.trim() ? JSON.parse(text) : {Count: 0, Results: []};
      } catch (e) {
        last = e;
        if (attempt < this.retries) await this.sleep(this.baseDelayMs * 2 ** attempt);
      }
    }
    throw new Error(`NHTSA request failed after ${this.retries + 1} tries: ${last?.message ?? last} (${url.split('?')[0]})`);
  }

  async decode(vin) {
    const j = await this.getJson(`${VPIC}/${encodeURIComponent(vin)}?format=json`);
    return j?.Results?.[0] ?? null;
  }

  // NHTSA spells the same model differently in each database (F-150 / F150, Beetle / NEW BEETLE),
  // so ask which names it knows for this make and year and pick the closest one.
  async modelNames(issueType, make, year) {
    this.modelCache ??= new Map();
    const key = `${issueType}|${make}|${year}`.toUpperCase();
    if (!this.modelCache.has(key)) {
      const j = await this.getJson(`${API}/products/vehicle/models?modelYear=${year}&make=${encodeURIComponent(make)}&issueType=${issueType}`, {emptyOn400: true});
      this.modelCache.set(key, (j?.results ?? []).map(r => String(r.model ?? '')).filter(Boolean));
    }
    return this.modelCache.get(key);
  }

  async resolveModel(issueType, make, model, year) {
    let names = [];
    try { names = await this.modelNames(issueType, make, year); } catch { /* fall back to the decoded name */ }
    return pickModel(names, model) ?? model;
  }

  async recalls({make, model, year}) {
    const m = await this.resolveModel('r', make, model, year);
    const q = `make=${encodeURIComponent(make)}&model=${encodeURIComponent(m)}&modelYear=${year}`;
    const j = await this.getJson(`${API}/recalls/recallsByVehicle?${q}`, {emptyOn400: true});
    return {model: m, rows: j?.results ?? []};
  }

  async complaints({make, model, year}) {
    const m = await this.resolveModel('c', make, model, year);
    const q = `make=${encodeURIComponent(make)}&model=${encodeURIComponent(m)}&modelYear=${year}`;
    const j = await this.getJson(`${API}/complaints/complaintsByVehicle?${q}`, {emptyOn400: true});
    return {model: m, rows: j?.results ?? []};
  }

  // Ratings are per "variant" (VehicleId); a model year can have several. Returns the variants that have ratings.
  async ratings({make, model, year}) {
    const base = `${API}/SafetyRatings/modelyear/${year}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`;
    const list = await this.getJson(base);
    const variants = list?.Results ?? [];
    const out = [];
    for (const v of variants.slice(0, 6)) {
      const d = await this.getJson(`${API}/SafetyRatings/VehicleId/${v.VehicleId}`);
      const r = d?.Results?.[0];
      if (r) out.push(r);
    }
    return out;
  }
}

const squash = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Pick the database's spelling of a model: exact after ignoring punctuation and case, else the
// shortest name that contains (or is contained in) the decoded name.
export function pickModel(names, model) {
  const want = squash(model);
  if (!want || !names?.length) return null;
  const exact = names.find(n => squash(n) === want);
  if (exact) return exact;
  const near = names.filter(n => squash(n).includes(want) || want.includes(squash(n))).sort((a, b) => a.length - b.length);
  return near[0] ?? null;
}

export function specsFromDecode(d) {
  if (!d) return null;
  return {
    year: num(d.ModelYear),
    make: clean(d.Make),
    model: clean(d.Model),
    trim: clean(d.Trim),
    series: clean(d.Series),
    bodyClass: clean(d.BodyClass),
    vehicleType: clean(d.VehicleType),
    doors: num(d.Doors),
    driveType: clean(d.DriveType),
    engineCylinders: num(d.EngineNumberofCylinders),
    engineDisplacementL: num(d.DisplacementL),
    engineHp: num(d.EngineHP),
    fuelType: clean(d.FuelTypePrimary),
    electrificationLevel: clean(d.ElectrificationLevel),
    transmission: clean(d.TransmissionStyle),
    gvwrClass: clean(d.GVWR),
    manufacturer: clean(d.Manufacturer),
    plantCountry: clean(d.PlantCountry),
    plantCity: clean(d.PlantCity),
    plantState: clean(d.PlantState),
    airbagLocFront: clean(d.AirBagLocFront),
    airbagLocSide: clean(d.AirBagLocSide),
    abs: clean(d.ABS),
    esc: clean(d.ESC),
    tpms: clean(d.TPMS)
  };
}

// vPIC error codes: 0 = clean decode. Codes containing 1 (check digit), 5/6/7/8/9/11 etc. flag partial or failed decodes.
export function decodeStatus(d) {
  if (!d) return {ok: false, level: 'none', codes: [], text: 'No answer from the VIN service'};
  const codes = String(d.ErrorCode ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const text = clean(d.ErrorText);
  const hasCore = clean(d.Make) && clean(d.Model) && num(d.ModelYear);
  if (!hasCore) return {ok: false, level: 'none', codes, text};
  return {ok: true, level: codes.length === 1 && codes[0] === '0' ? 'full' : 'partial', codes, text};
}

export function summarizeRecalls(rows) {
  return rows.map(r => ({
    campaignNumber: clean(r.NHTSACampaignNumber),
    manufacturer: clean(r.Manufacturer),
    reportReceivedDate: clean(r.ReportReceivedDate),
    component: clean(r.Component),
    summary: clean(r.Summary),
    consequence: clean(r.Consequence),
    remedy: clean(r.Remedy),
    parkIt: Boolean(r.parkIt),
    parkOutSide: Boolean(r.parkOutSide),
    overTheAirUpdate: Boolean(r.overTheAirUpdate)
  })).sort((a, b) => parseNhtsaDate(b.reportReceivedDate) - parseNhtsaDate(a.reportReceivedDate));
}

// NHTSA dates look like "27/06/2024" (dd/mm/yyyy).
export function parseNhtsaDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s ?? '');
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : 0;
}

export function summarizeComplaints(rows, keep) {
  const byComponent = new Map();
  let crashes = 0, fires = 0, injuries = 0, deaths = 0;
  for (const r of rows) {
    for (const c of String(r.components ?? 'UNKNOWN').split(',')) {
      const k = c.trim() || 'UNKNOWN';
      byComponent.set(k, (byComponent.get(k) ?? 0) + 1);
    }
    if (r.crash) crashes++;
    if (r.fire) fires++;
    injuries += Number(r.numberOfInjuries) || 0;
    deaths += Number(r.numberOfDeaths) || 0;
  }
  const topComponents = [...byComponent].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([component, count]) => ({component, count}));
  const recent = [...rows].sort((a, b) => parseNhtsaDate(b.dateComplaintFiled) - parseNhtsaDate(a.dateComplaintFiled)).slice(0, keep).map(r => ({
    odiNumber: r.odiNumber ?? null,
    dateComplaintFiled: clean(r.dateComplaintFiled),
    dateOfIncident: clean(r.dateOfIncident),
    components: clean(r.components),
    crash: Boolean(r.crash),
    fire: Boolean(r.fire),
    injuries: Number(r.numberOfInjuries) || 0,
    deaths: Number(r.numberOfDeaths) || 0,
    summary: clean(r.summary)
  }));
  return {total: rows.length, crashes, fires, injuries, deaths, topComponents, recent};
}

export function summarizeRatings(rows) {
  return rows.map(r => ({
    vehicleId: r.VehicleId ?? null,
    description: clean(r.VehicleDescription),
    overall: clean(r.OverallRating),
    frontCrash: clean(r.OverallFrontCrashRating),
    sideCrash: clean(r.OverallSideCrashRating),
    rollover: clean(r.RolloverRating),
    rolloverPossibility: num(r.RolloverPossibility),
    complaintsCount: num(r.ComplaintsCount),
    recallsCount: num(r.RecallsCount),
    investigationCount: num(r.InvestigationCount)
  }));
}

const SOURCE = 'NHTSA (US National Highway Traffic Safety Administration) public data';

// Build one dataset item. Returns {item, billable}: billable is true only when a real decode was delivered.
export async function buildReport(client, rawVin, opts) {
  const {includeRecalls = true, includeComplaints = true, includeRatings = true, maxComplaintsPerVehicle = 5} = opts ?? {};
  const vin = normalizeVin(rawVin);
  const base = {vin, inputVin: String(rawVin ?? ''), checkedAt: new Date().toISOString(), source: SOURCE};
  if (!VIN_RE.test(vin)) {
    return {billable: false, item: {...base, status: 'invalid_vin', error: 'A VIN is 17 letters and digits (no I, O or Q).'}};
  }
  const warnings = [];
  if (!checkDigitOk(vin)) warnings.push('Check digit (position 9) does not match. Normal for some non-North-American vehicles; otherwise the VIN may contain a typo.');

  let decoded;
  try {
    decoded = await client.decode(vin);
  } catch (e) {
    return {billable: false, item: {...base, status: 'lookup_failed', error: e.message}};
  }
  const st = decodeStatus(decoded);
  if (!st.ok) {
    return {billable: false, item: {...base, status: 'not_decodable', decodeMessage: st.text, decodeCodes: st.codes, warnings}};
  }
  const specs = specsFromDecode(decoded);
  const item = {...base, status: st.level === 'full' ? 'ok' : 'partial', decodeMessage: st.level === 'full' ? null : st.text, decodeCodes: st.codes, ...specs, warnings};
  const veh = {make: specs.make, model: specs.model, year: specs.year};

  const tasks = [];
  if (includeRecalls) tasks.push(client.recalls(veh).then(({model, rows}) => {
    const list = summarizeRecalls(rows);
    item.recallsModelName = model;
    item.recallCount = list.length;
    item.recallsNote = 'Recall campaigns that apply to this make, model and year. NHTSA does not publish whether this specific car was already repaired: check with the manufacturer or a dealer using the VIN.';
    item.recalls = list;
  }));
  if (includeComplaints) tasks.push(client.complaints(veh).then(({model, rows}) => {
    const s = summarizeComplaints(rows, maxComplaintsPerVehicle);
    item.complaintsModelName = model;
    item.complaintCount = s.total;
    item.complaintSummary = {crashes: s.crashes, fires: s.fires, injuries: s.injuries, deaths: s.deaths, topComponents: s.topComponents};
    item.recentComplaints = s.recent;
  }));
  if (includeRatings) tasks.push(client.ratings(veh).then(rows => {
    const list = summarizeRatings(rows);
    item.safetyRatings = list;
    item.overallSafetyRating = list.find(r => r.overall && /^\d/.test(r.overall))?.overall ?? null;
  }));
  const results = await Promise.allSettled(tasks);
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) {
    item.status = 'partial';
    for (const f of failed) warnings.push(`Part of the data could not be fetched: ${f.reason?.message ?? f.reason}`);
  }
  return {billable: true, item};
}
