# Domain WHOIS / RDAP Lookup: Age, Expiry, Registrar

Look up any list of domains in the registries' official RDAP service, the modern, structured replacement for WHOIS. For each domain: registration date and age, expiry date and days left, registrar and its IANA ID, abuse contact, status codes, nameservers and DNSSEC. If the registry has no record, the domain is reported as not registered.

**$2 per 1,000 domains.** "Not registered" answers count. Top-level domains whose registry has no RDAP service, invalid input and failed lookups are free.

## Good for

- **Domain investing**: find expiring or old domains, and check availability in bulk
- **Fraud and trust checks**: brand-new domains are a common phishing signal (`ageYears`)
- **Portfolio management**: track expiry dates across all your domains
- **Lead research**: registrar and nameserver data for a list of companies

## Output (one row per domain, shortened)

```json
{
  "domain": "apify.com",
  "status": "ok",
  "registered": true,
  "registrar": "GoDaddy.com, LLC",
  "registrarIanaId": "146",
  "createdDate": "2015-01-12T15:11:56Z",
  "expiryDate": "2031-01-12T15:11:56Z",
  "daysUntilExpiry": 1565,
  "ageYears": 11.7,
  "statuses": ["client transfer prohibited"],
  "nameservers": ["ns-1234.awsdns-26.org"],
  "dnssec": false,
  "abuseEmail": "abuse@godaddy.com"
}
```

## Notes and limits

- Data comes straight from each registry's RDAP server, found through IANA's official bootstrap list. Most generic domains (.com, .net, .org, .io, .app, .dev and hundreds more) and many country codes are covered. A few country registries don't offer RDAP; those rows say `rdap_not_available` and are free.
- Registrant names and addresses are usually redacted for privacy (GDPR), so they are not returned.
- `registered: false` means the registry has no record. It is a strong sign the name is available, but some registries also hide reserved or premium names.
- Subdomains are reduced to the registered domain (www.shop.example.co.uk → example.co.uk).
