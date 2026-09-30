# ship email-validator 2026-09-30T16:15:49Z c7de7ed
## unit tests
```
# tests 16
# pass 16
# fail 0
```
## push
```
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: tViGOneD9RwQiby8n
Build ID: rZdCqUCQAo0zXA1tQ
Build number: 0.1.1

Actor URL: https://console.apify.com/actors/tViGOneD9RwQiby8n
Build URL: https://console.apify.com/actors/tViGOneD9RwQiby8n#/builds/0.1.1
```
## Apify setup and test run
```
actor Dodge_Bot/email-validator
pricing + store details: 200  ok
pricing confirmed: True {'email': 0.001}
test run: SUCCEEDED, Processed 6 of 6 emails. Charged 6; 0 not charged (errors, blocked or invalid)., secs 1.768, platform cost $9.920014554924437e-05, items 6, ok 6
   {"input": "someone@mailinator.com", "checkedAt": "2026-09-30T16:16:13.221Z", "status": "ok", "email": "someone@mailinator.com", "verdict": "risky", "syntaxValid": true, "reasons": ["disposable (throwaway) email provider"], "domain": "mailinator.com", "localPart": "someone", "mailServer": true, "mxRecords": ["mail.mailinator.com", "mail2.mailinator.com"], "nullMx": false, "disposable": true, "freeP …
   {"input": "no-at-sign.com", "checkedAt": "2026-09-30T16:16:13.221Z", "status": "ok", "email": null, "verdict": "invalid", "syntaxValid": false, "reasons": ["missing @ or empty part"]}
   {"input": "jane.doe@gmail.com", "checkedAt": "2026-09-30T16:16:13.219Z", "status": "ok", "email": "jane.doe@gmail.com", "verdict": "valid", "syntaxValid": true, "reasons": [], "domain": "gmail.com", "localPart": "jane.doe", "mailServer": true, "mxRecords": ["gmail-smtp-in.l.google.com", "alt1.gmail-smtp-in.l.google.com", "alt2.gmail-smtp-in.l.google.com", "alt3.gmail-smtp-in.l.google.com", "alt4.g …
   {"input": "info@apify.com", "checkedAt": "2026-09-30T16:16:13.221Z", "status": "ok", "email": "info@apify.com", "verdict": "risky", "syntaxValid": true, "reasons": ["role address (shared inbox such as info@ or sales@)"], "domain": "apify.com", "localPart": "info", "mailServer": true, "mxRecords": ["aspmx.l.google.com", "alt1.aspmx.l.google.com", "alt2.aspmx.l.google.com", "aspmx3.googlemail.com",  …
   {"input": "x@this-domain-should-not-exist-570zx.com", "checkedAt": "2026-09-30T16:16:13.221Z", "status": "ok", "email": "x@this-domain-should-not-exist-570zx.com", "verdict": "invalid", "syntaxValid": true, "reasons": ["domain does not exist"], "domain": "this-domain-should-not-exist-570zx.com", "localPart": "x", "mailServer": false, "mxRecords": [], "nullMx": false, "disposable": false, "freeProv …
   {"input": "bob@gmial.com", "checkedAt": "2026-09-30T16:16:13.221Z", "status": "ok", "email": "bob@gmial.com", "verdict": "risky", "syntaxValid": true, "reasons": ["possible typo, did you mean bob@gmail.com?", "no MX record; mail would go to the domain's web server address"], "domain": "gmial.com", "localPart": "bob", "mailServer": true, "mxRecords": ["gmial.com"], "nullMx": false, "disposable": fa …
public: 429 {"type": "daily-publication-limit-exceeded", "message": "You\u2019ve reached the daily limit of 5 Actor publications. Try again in 24 hours."}
```
