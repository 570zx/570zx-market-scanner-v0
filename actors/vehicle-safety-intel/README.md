# VIN Decoder + Recalls + Complaints + Crash Ratings (NHTSA)

Give it VINs. Get back one clean record per vehicle: specs, safety recall campaigns, owner complaint counts and the most affected components, and NHTSA crash-test star ratings. All from official US government data (NHTSA), no scraping and no login.

Built for AI agents and for repair shops, insurers, used-car buyers and dealers who need the same lookup for many vehicles.

## What you get per VIN

| Field group | Contents |
|---|---|
| Specs | Year, make, model, trim, body, drive type, engine size and power, fuel, transmission, plant, airbags, GVWR class |
| Recalls | Every NHTSA recall campaign for this make, model and year: number, component, summary, consequence, remedy, "park it" and over-the-air flags |
| Complaints | Total owner complaints, crashes, fires, injuries, deaths, top 8 components, and the most recent complaints (you choose how many) |
| Crash ratings | NHTSA 5-star overall, front, side and rollover ratings, when the vehicle was rated |

## Pricing

You pay per delivered vehicle report. Invalid VINs, VINs that cannot be decoded, and failed lookups are not charged. Set a maximum cost per run and the Actor stops when it is reached.

## Input

- **VINs**: one 17-character VIN per line, up to 1,000 per run. Duplicates are removed.
- **Include recalls / complaints / ratings**: switch off what you do not need for faster runs.
- **Recent complaints per vehicle**: 0 to 50 (counts are always included).

## Output example (shortened)

```json
{
  "vin": "5YJ3E1EA7KF317000",
  "status": "partial",
  "year": 2019, "make": "TESLA", "model": "Model 3",
  "recallCount": 22,
  "complaintCount": 614,
  "complaintSummary": {"crashes": 0, "topComponents": [{"component": "...", "count": 0}]},
  "overallSafetyRating": "5",
  "warnings": ["Check digit (position 9) does not match. ..."]
}
```

`status` is `ok` (complete), `partial` (decoded but a warning applies, such as a check-digit mismatch or one lookup failing), `invalid_vin`, `not_decodable` or `lookup_failed`. Read `warnings` and `decodeMessage` when status is not `ok`.

## What this does not tell you

- **Recalls are per model and year, not per car.** NHTSA does not publish whether a specific VIN was already repaired. Use the manufacturer's VIN recall lookup or a dealer to confirm open recalls on a particular car.
- **Complaints are unverified reports** filed by owners. They are a signal, not proof of a defect.
- **Ratings exist only for vehicles NHTSA tested.** Older and low-volume vehicles often show no rating.
- Model names differ between NHTSA databases (for example F-150 and F150). The Actor matches them automatically and lists the names it used in `recallsMatchedModels` and `complaintsMatchedModels`. If a model still returns no records, the name may not match: check those fields.
- Coverage is the US market. Vehicles built for other markets may decode partially or not at all.
- This is information, not legal, safety or insurance advice, and it is not affiliated with NHTSA.

## Data sources

NHTSA vPIC (VIN decoding), NHTSA Recalls, Complaints and Safety Ratings APIs. Public US government data.
