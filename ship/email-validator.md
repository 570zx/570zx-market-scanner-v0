# ship email-validator 2026-09-30T17:28:47Z 1a2ee6848810d221fb4b4b76269f831097e3106b
## unit tests
```
# tests 16
# pass 16
# fail 0
```
## push
```
2026-09-30T17:29:06.653Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: tViGOneD9RwQiby8n
Build ID: av9DbqlVTpQf5HPoc
Build number: 0.1.2

Actor URL: https://console.apify.com/actors/tViGOneD9RwQiby8n
Build URL: https://console.apify.com/actors/tViGOneD9RwQiby8n#/builds/0.1.2
```
## Apify setup and test run
```
actor Dodge_Bot/email-validator
pricing + store details: 400  {"type": "schema-validation", "message": "Invalid value provided in checkAndSanitizePricingInfosModifier[existing_record]: createdAt is required"}
pricing confirmed: True {'email': 0.001}
test run: SUCCEEDED, Processed 6 of 6 emails. Charged 6; 0 not charged (errors, blocked or invalid)., secs 2.127, platform cost $0.00010966876270373663, items 6, ok 6
   {"input": "jane.doe@gmail.com", "checkedAt": "2026-09-30T17:29:09.677Z", "status": "ok", "email": "jane.doe@gmail.com", "verdict": "valid", "syntaxValid": true, "reasons": [], "domain": "gmail.com", "localPart": "jane.doe", "mailServer": true, "mxRecords": ["gmail-smtp-in.l.google.com", "alt1.gmail-smtp-in.l.google.com", "alt2.gmail-smtp-in.l.google.com", "alt3.gmail-smtp-in.l.google.com", "alt4.g …
   {"input": "x@this-domain-should-not-exist-570zx.com", "checkedAt": "2026-09-30T17:29:09.679Z", "status": "ok", "email": "x@this-domain-should-not-exist-570zx.com", "verdict": "invalid", "syntaxValid": true, "reasons": ["domain does not exist"], "domain": "this-domain-should-not-exist-570zx.com", "localPart": "x", "mailServer": false, "mxRecords": [], "nullMx": false, "disposable": false, "freeProv …
   {"input": "no-at-sign.com", "checkedAt": "2026-09-30T17:29:09.679Z", "status": "ok", "email": null, "verdict": "invalid", "syntaxValid": false, "reasons": ["missing @ or empty part"]}
   {"input": "info@apify.com", "checkedAt": "2026-09-30T17:29:09.679Z", "status": "ok", "email": "info@apify.com", "verdict": "risky", "syntaxValid": true, "reasons": ["role address (shared inbox such as info@ or sales@)"], "domain": "apify.com", "localPart": "info", "mailServer": true, "mxRecords": ["aspmx.l.google.com", "alt1.aspmx.l.google.com", "alt2.aspmx.l.google.com", "aspmx2.googlemail.com",  …
   {"input": "someone@mailinator.com", "checkedAt": "2026-09-30T17:29:09.679Z", "status": "ok", "email": "someone@mailinator.com", "verdict": "risky", "syntaxValid": true, "reasons": ["disposable (throwaway) email provider"], "domain": "mailinator.com", "localPart": "someone", "mailServer": true, "mxRecords": ["mail2.mailinator.com", "mail.mailinator.com"], "nullMx": false, "disposable": true, "freeP …
   {"input": "bob@gmial.com", "checkedAt": "2026-09-30T17:29:09.679Z", "status": "ok", "email": "bob@gmial.com", "verdict": "risky", "syntaxValid": true, "reasons": ["possible typo, did you mean bob@gmail.com?", "no MX record; mail would go to the domain's web server address"], "domain": "gmial.com", "localPart": "bob", "mailServer": true, "mxRecords": ["gmial.com"], "nullMx": false, "disposable": fa …
```
