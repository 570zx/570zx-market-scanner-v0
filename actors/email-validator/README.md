# Email Validator: Syntax, MX, Disposable & Role Check

Clean an email list before you send to it. For each address you get a verdict (`valid`, `risky` or `invalid`) with the reasons: bad syntax, a domain that doesn't exist or can't receive email, disposable (throwaway) providers, role addresses such as info@ or sales@, free providers such as Gmail, and typo fixes such as gmial.com → gmail.com.

**$1 per 1,000 addresses.** Invalid addresses are charged (finding them is the point); temporary DNS failures are free.

## Good for

- Cleaning sign-up forms and CRM exports to cut bounces
- Filtering lead lists before outreach
- Separating business addresses from free and throwaway ones

## Output (one row per address)

```json
{
  "input": "bob@gmial.com",
  "email": "bob@gmial.com",
  "verdict": "risky",
  "reasons": ["possible typo, did you mean bob@gmail.com?"],
  "syntaxValid": true,
  "mailServer": true,
  "mxRecords": ["mx.gmial.com"],
  "disposable": false,
  "roleAccount": false,
  "freeProvider": false,
  "typoSuggestion": "bob@gmail.com"
}
```

| Verdict | Meaning |
|---|---|
| `valid` | Correct syntax, and the domain has a working mail setup |
| `risky` | Deliverable domain, but disposable, a role address, or a likely typo |
| `invalid` | Bad syntax, the domain doesn't exist, has no mail server, or declares it takes no email (null MX) |
| `unknown` | DNS didn't answer (not charged); try again later |

## What it does not do

- **It does not check whether the mailbox itself exists.** That needs connecting to the recipient's mail server, which many providers block or treat as abuse; this tool never does it. An address can pass here and still bounce if the person left the company.
- The disposable list covers hundreds of well-known providers, but new throwaway domains appear every day.
- No emails are sent.
