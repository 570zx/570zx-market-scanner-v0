# eu-vat-validator  2026-09-30T16:26:06Z ec026a8
## install
```
npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.

added 187 packages in 2s
```
## unit tests
```
# tests 13
# pass 13
# fail 0
```
## local run on test input
```
[33mWARN[39m  Ignored attempt to charge for an event - the Actor does not use the pay-per-event pricing
[32mINFO[39m  [Status message]: Processed 5 of 5 VAT numbers
[32mINFO[39m  [Status message]: Processed 5 of 5 VAT numbers. Charged 5; 0 not charged (errors, blocked or invalid).
```
## items
5 items
```json
{"input": "GB123456789", "checkedAt": "2026-09-30T16:26:08.955Z", "status": "ok", "valid": false, "country": "GB", "vatNumber": "123456789", "reason": "UK (GB) VAT numbers are no longer in VIES since Brexit; only Northern Ireland (XI) numbers are.", "source": "format check"}
```
```json
{"input": "DE12", "checkedAt": "2026-09-30T16:26:08.979Z", "status": "ok", "valid": false, "country": "DE", "vatNumber": "12", "reason": "Wrong format for a DE VAT number", "source": "format check"}
```
```json
{"input": "NL000000000B00", "checkedAt": "2026-09-30T16:26:08.955Z", "status": "ok", "valid": false, "country": "NL", "vatNumber": "000000000B00", "fullVatNumber": "NL000000000B00", "companyName": null, "companyAddress": null, "viesRequestDate": "2026-09-30T16:26:09.481Z", "reason": "Not registered for intra-EU trade in VIES", "source": "VIES"}
```
```json
{"input": "IE6388047V", "checkedAt": "2026-09-30T16:26:08.954Z", "status": "ok", "valid": true, "country": "IE", "vatNumber": "6388047V", "fullVatNumber": "IE6388047V", "companyName": "GOOGLE IRELAND LIMITED", "companyAddress": "3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4", "viesRequestDate": "2026-09-30T16:26:09.647Z", "reason": null, "source": "VIES"}
```
```json
{"input": "DE811569869", "checkedAt": "2026-09-30T16:26:08.955Z", "status": "ok", "valid": true, "country": "DE", "vatNumber": "811569869", "fullVatNumber": "DE811569869", "companyName": null, "companyAddress": null, "viesRequestDate": "2026-09-30T16:26:11.569Z", "reason": null, "source": "VIES"}
```
