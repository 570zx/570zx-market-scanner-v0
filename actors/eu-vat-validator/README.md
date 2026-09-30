# EU VAT Number Validator (VIES) with Company Name

Check EU VAT numbers in bulk against VIES, the European Commission's official VAT Information Exchange System. For each number you get whether it is valid for intra-EU trade and, where the member state publishes them, the registered company name and address. Every number also gets a format check first, so typos are caught instantly.

**$2 per 1,000 numbers checked.** Invalid and badly formatted numbers count (that's the answer you need); numbers VIES can't answer because a national system is down are free.

## Good for

- **E-commerce and SaaS billing**: confirm a customer's VAT number before applying the reverse charge
- **Accounting and finance teams**: clean supplier and customer master data
- **KYB checks**: confirm a company's registered name and address

## Output (one row per number)

| Field | Meaning |
|---|---|
| `valid` | true if VIES confirms the number is active for intra-EU trade |
| `fullVatNumber`, `country`, `vatNumber` | The normalised number (Greece uses the prefix EL) |
| `companyName`, `companyAddress` | As registered, when the country shares them (Germany and Spain, for example, do not) |
| `reason` | Why a number is not valid: wrong format, not registered, UK number, missing prefix |
| `viesRequestDate` | Date of the VIES check |
| `status` | `ok`, or `vies_unavailable` (free) when the national system didn't answer after retries |

## Input

- **VAT numbers**: with country prefix. Spaces, dots and dashes are removed for you.
- **Default country**: optional, for numbers without a prefix.

## Notes and limits

- VIES only covers the 27 EU member states and Northern Ireland (`XI`). UK (`GB`) numbers have not been in VIES since Brexit; they're flagged as such and not sent to VIES.
- National systems behind VIES sometimes go offline or throttle (`MS_UNAVAILABLE`, `MS_MAX_CONCURRENT_REQ`). The tool retries with pauses, and only reports `vies_unavailable` (free) if the country still doesn't answer.
- A valid VIES result means the number is registered for intra-EU transactions; it is not a full tax-compliance check.
