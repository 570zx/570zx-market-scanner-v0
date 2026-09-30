# ship eu-vat-validator 2026-09-30T16:30:34Z c00dcdcb151da2664345188cc9312b96c921739c
## unit tests
```
# tests 13
# pass 13
# fail 0
```
## push
```
2026-09-30T16:30:55.604Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: dFxy70u7Li9Cqcg4y
Build ID: LbtPOr0zA1LcE0apG
Build number: 0.1.1

Actor URL: https://console.apify.com/actors/dFxy70u7Li9Cqcg4y
Build URL: https://console.apify.com/actors/dFxy70u7Li9Cqcg4y#/builds/0.1.1
```
## Apify setup and test run
```
actor Dodge_Bot/eu-vat-validator
pricing + store details: 200  ok
pricing confirmed: True {'vat-check': 0.002}
test run: SUCCEEDED, Processed 5 of 5 VAT numbers. Charged 4; 1 not charged (errors, blocked or invalid)., secs 23.556, platform cost $0.0007342146743436656, items 5, ok 4
   {"input": "GB123456789", "checkedAt": "2026-09-30T16:30:59.744Z", "status": "ok", "valid": false, "country": "GB", "vatNumber": "123456789", "reason": "UK (GB) VAT numbers are no longer in VIES since Brexit; only Northern Ireland (XI) numbers are.", "source": "format check"}
   {"input": "DE12", "checkedAt": "2026-09-30T16:30:59.853Z", "status": "ok", "valid": false, "country": "DE", "vatNumber": "12", "reason": "Wrong format for a DE VAT number", "source": "format check"}
   {"input": "NL000000000B00", "checkedAt": "2026-09-30T16:30:59.744Z", "status": "ok", "valid": false, "country": "NL", "vatNumber": "000000000B00", "fullVatNumber": "NL000000000B00", "companyName": null, "companyAddress": null, "viesRequestDate": "2026-09-30T16:31:00.075Z", "reason": "Not registered for intra-EU trade in VIES", "source": "VIES"}
   {"input": "IE6388047V", "checkedAt": "2026-09-30T16:30:59.743Z", "status": "ok", "valid": true, "country": "IE", "vatNumber": "6388047V", "fullVatNumber": "IE6388047V", "companyName": "GOOGLE IRELAND LIMITED", "companyAddress": "3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4", "viesRequestDate": "2026-09-30T16:31:00.183Z", "reason": null, "source": "VIES"}
   {"input": "DE811569869", "checkedAt": "2026-09-30T16:30:59.744Z", "status": "vies_unavailable", "country": "DE", "vatNumber": "811569869", "error": "VIES could not answer (MS_MAX_CONCURRENT_REQ). The member state's system may be down; try again later."}
```
