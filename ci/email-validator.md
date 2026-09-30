# email-validator  2026-09-30T16:09:58Z 76a5b0c
## install
```
npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.

added 187 packages in 3s
```
## unit tests
```
# tests 16
# pass 16
# fail 0
```
## local run on test input
```
[33mWARN[39m  Ignored attempt to charge for an event - the Actor does not use the pay-per-event pricing
[32mINFO[39m  [Status message]: Processed 5 of 6 emails
[32mINFO[39m  [Status message]: Processed 6 of 6 emails
[32mINFO[39m  [Status message]: Processed 6 of 6 emails. Charged 6; 0 not charged (errors, blocked or invalid).
```
## items
6 items
```json
{"input": "no-at-sign.com", "checkedAt": "2026-09-30T16:10:02.384Z", "status": "ok", "email": null, "verdict": "invalid", "syntaxValid": false, "reasons": ["missing @ or empty part"]}
```
```json
{"input": "info@apify.com", "checkedAt": "2026-09-30T16:10:02.383Z", "status": "ok", "email": "info@apify.com", "verdict": "risky", "syntaxValid": true, "reasons": ["role address (shared inbox such as info@ or sales@)"], "domain": "apify.com", "localPart": "info", "mailServer": true, "mxRecords": ["aspmx.l.google.com", "alt1.aspmx.l.google.com", "alt2.aspmx.l.google.com", "aspmx3.googlemail.com", "aspmx2.googlemail.com"], "nullMx": false, "disposable": false, "freeProvider": false, "roleAccount": true, "typoSuggestion": null}
```
```json
{"input": "jane.doe@gmail.com", "checkedAt": "2026-09-30T16:10:02.383Z", "status": "ok", "email": "jane.doe@gmail.com", "verdict": "valid", "syntaxValid": true, "reasons": [], "domain": "gmail.com", "localPart": "jane.doe", "mailServer": true, "mxRecords": ["gmail-smtp-in.l.google.com", "alt1.gmail-smtp-in.l.google.com", "alt2.gmail-smtp-in.l.google.com", "alt3.gmail-smtp-in.l.google.com", "alt4.gmail-smtp-in.l.google.com"], "nullMx": false, "disposable": false, "freeProvider": true, "roleAccount": false, "typoSuggestion": null}
```
```json
{"input": "x@this-domain-should-not-exist-570zx.com", "checkedAt": "2026-09-30T16:10:02.384Z", "status": "ok", "email": "x@this-domain-should-not-exist-570zx.com", "verdict": "invalid", "syntaxValid": true, "reasons": ["domain does not exist"], "domain": "this-domain-should-not-exist-570zx.com", "localPart": "x", "mailServer": false, "mxRecords": [], "nullMx": false, "disposable": false, "freeProvider": false, "roleAccount": false, "typoSuggestion": null}
```
```json
{"input": "someone@mailinator.com", "checkedAt": "2026-09-30T16:10:02.383Z", "status": "ok", "email": "someone@mailinator.com", "verdict": "risky", "syntaxValid": true, "reasons": ["disposable (throwaway) email provider"], "domain": "mailinator.com", "localPart": "someone", "mailServer": true, "mxRecords": ["mail.mailinator.com", "mail2.mailinator.com"], "nullMx": false, "disposable": true, "freeProvider": false, "roleAccount": false, "typoSuggestion": null}
```
```json
{"input": "bob@gmial.com", "checkedAt": "2026-09-30T16:10:02.384Z", "status": "ok", "email": "bob@gmial.com", "verdict": "risky", "syntaxValid": true, "reasons": ["possible typo, did you mean bob@gmail.com?", "no MX record; mail would go to the domain's web server address"], "domain": "gmial.com", "localPart": "bob", "mailServer": true, "mxRecords": ["gmial.com"], "nullMx": false, "disposable": false, "freeProvider": false, "roleAccount": false, "typoSuggestion": "bob@gmail.com"}
```
