# Domain Email Security Checker: SPF, DMARC, DKIM, MX

Check a list of domains for email authentication and spoofing protection in one run. For each domain you get an A-F grade, a plain-English list of problems, and the raw records: SPF, DMARC, DKIM (on 30 common selector names), MX and mail provider, MTA-STS, TLS-RPT and BIMI.

**$3 per 1,000 domains.** A domain that does not exist is a valid result (grade F). Invalid input and DNS outages are free.

## Good for

- **Deliverability audits**: find why a client's email lands in spam
- **Security and IT agencies**: find prospects whose domains can be spoofed (no DMARC, or p=none)
- **Vendor and supply-chain checks**: review suppliers' email protection
- **Monitoring your own domains** after DNS changes

## What is checked

| Area | Checks |
|---|---|
| SPF | Present, only one record, ends in `-all`/`~all` (flags `+all` and `?all`), top-level DNS lookups against the limit of 10, includes |
| DMARC | Present, valid policy, `p=none` (monitoring only), `pct` below 100, aggregate reports (`rua`) set |
| DKIM | Keys found on 30 common selectors (Google, Microsoft 365, SendGrid, Mailchimp/Mandrill, Amazon SES, Zoho, Fastmail, HubSpot and more), key type and approximate size, revoked keys |
| MX | Mail servers, detected provider (Google Workspace, Microsoft 365, Proofpoint, Mimecast and others), null MX |
| Extras | MTA-STS, TLS-RPT, BIMI |

Grade: **A** no problems; **B** one warning; **C** two or more warnings; **D** one error; **F** two or more errors, or the domain does not exist.

## Output (one row per domain, shortened)

```json
{
  "domain": "example.com",
  "status": "ok",
  "grade": "D",
  "mailProvider": null,
  "spfRecord": "v=spf1 -all",
  "dmarcPolicy": "reject",
  "dkimSelectorsFound": [],
  "issues": [
    {"severity": "notice", "code": "null_mx", "message": "Null MX: the domain states it never receives email."}
  ]
}
```

## Limits

- DKIM selectors can't be listed from DNS, so only 30 common names are tried. "Not found" can mean the domain uses a custom selector; it is reported as a notice, not an error.
- The SPF lookup count covers the top-level record, not every nested include.
- It only reads public DNS. No emails are sent and no servers are probed.
