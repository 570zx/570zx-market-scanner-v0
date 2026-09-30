# Company Jobs API: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee

Get every open job from company career pages in one clean format. Most tech companies and many others run their careers page on an applicant tracking system (ATS) that publishes a public job-board feed. This tool reads those feeds for Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee, and returns one row per job: title, location, remote flag, department, employment type, salary where the company publishes it, posted date, job and apply links, and the full description.

**$1 per 1,000 jobs.** Companies with no board found are free.

## Good for

- **Job boards and aggregators**: fresh listings straight from the source, not reposts
- **Recruiters and job seekers**: watch a list of target companies for new roles (filter by title, location, remote, date)
- **Sales intelligence**: hiring is a buying signal. A company hiring "Head of Data" may need data tools
- **Market research**: count openings by department to see who is growing

## Input

- **Companies**: careers URLs (e.g. `https://boards.greenhouse.io/airbnb`, `https://jobs.lever.co/spotify`, `https://jobs.ashbyhq.com/openai`, `https://apply.workable.com/huggingface/`), `ats:slug` pairs like `lever:spotify`, or just a company name, in which case each ATS is tried in turn.
- **Filters** (optional): title keywords, locations (use "Remote" to match remote jobs), remote only, posted within N days.
- **Include job description**: on by default.

## Output (one row per job; real result from 30 Sep 2026)

```json
{
  "input": "https://jobs.ashbyhq.com/openai",
  "status": "ok",
  "ats": "ashby",
  "company": "openai",
  "jobId": "240d459b-696d-43eb-8497-fab3e56ecd9b",
  "title": "Research Engineer",
  "location": "San Francisco",
  "department": "Research",
  "employmentType": "FullTime",
  "remote": false,
  "url": "https://jobs.ashbyhq.com/openai/240d459b-696d-43eb-8497-fab3e56ecd9b",
  "applyUrl": "https://jobs.ashbyhq.com/openai/240d459b-696d-43eb-8497-fab3e56ecd9b/application",
  "postedAt": "2025-04-05T00:03:20.653Z",
  "salary": "$250K – $445K • Offers Equity"
}
```

## Notes and limits

- Only companies whose careers page runs on one of these six systems are covered. Workday, iCIMS, Taleo, LinkedIn and Indeed are not.
- Salary appears only when the company publishes it in its board feed (common on Ashby and Lever, and for roles where pay transparency laws apply).
- SmartRecruiters' public feed has no description text; use the job URL for details.
- These are the official public feeds the ATS vendors provide for embedding job boards. No scraping of job sites, no logins.
