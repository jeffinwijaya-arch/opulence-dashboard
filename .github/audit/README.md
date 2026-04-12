# Hourly audit

An automated read-only audit of the opulence-dashboard runs every hour
via `.github/workflows/hourly-audit.yml`. It never modifies source code,
never regenerates data, and never deploys — it reads the repo, runs the
existing test suites, optionally pings production, and writes two files
here.

## Files in this directory

- **`LATEST.md`** — overwritten each run with the latest full report.
  Read this first.
- **`HISTORY.md`** — one row per run, trimmed to the last 168 rows
  (7 days × 24 hours). Shows the status of every check over time so
  you can spot regressions.
- **`DISABLED`** (if present) — kill switch. See below.
- **`README.md`** — this file.

## What the audit checks

1. **Tests (pytest)** — the 144-test Python suite must stay green.
2. **Tests (vitest)** — the 106-test JavaScript suite must stay green.
3. **Data schemas** — every `public/data/*.json` must match the
   Draft-7 schemas in `tests/schemas/data_schemas.py`.
4. **Pipeline parity** — `export_data.py` and
   `scripts/rebuild_dashboard_data.py` must produce identical output
   from identical input (the invariant documented in
   `export_data.py:40-43`).
5. **API endpoint gaps** — enumerates every `fetch('/api/...')`
   target in `public/index.html` and `public/modules/*.js`, compares
   against the static JSON files the Cloudflare Worker can serve, and
   lists the first 10 missing endpoints by name. This one is
   deliberately loud: the dashboard currently has ~125 endpoints that
   return 404 in the static deploy because they assume a Python
   backend that isn't shipped with the Pages deploy.
6. **Data freshness** — reads `public/data/summary.json`'s
   `updated_at` field and warns if it's >12h old, fails if >48h.
7. **Production health** — probes `DASHBOARD_URL` if set. Skipped
   otherwise. See the "Enabling production health checks" section.
8. **Recent commits** — last 5 commits on the current branch. Useful
   context when reading a historical report.

## Status values

- **OK** — check passed.
- **WARN** — check found something worth looking at but nothing broken.
- **FAIL** — check found a hard problem.
- **SKIP** — check was skipped (dependency missing, toggle off, etc).

The **overall** status at the top of `LATEST.md` is the worst status
across all checks.

## Kill switch

If the audit starts misbehaving — or you just want to stop the hourly
commit noise for a while — create an empty file called `DISABLED` in
this directory:

```bash
touch .github/audit/DISABLED
git add .github/audit/DISABLED
git commit -m "audit: disable hourly audit"
git push
```

The workflow checks for this file at the very first step and exits
cleanly if it exists. To re-enable, just delete the file.

Both the workflow *and* the audit script honor this file, so it also
works when running `python3 scripts/audit_repo.py` locally.

## Enabling production health checks

The `health` check is skipped unless you set a repository variable
called `DASHBOARD_URL`. To enable it:

1. Go to the repo **Settings → Secrets and variables → Actions → Variables**.
2. Add a new variable:
   - Name: `DASHBOARD_URL`
   - Value: your production URL (e.g. `https://opulence-dashboard.pages.dev`)
3. The next hourly run will probe:
   - `GET /`
   - `GET /data/bundle.json`
   - `GET /api/deals`
   - `GET /api/arbitrage`
   - `GET /api/summary`
   - `GET /api/refs`
   Each with a 10-second timeout. Results (status code + response time)
   land in the report.

Health check failures don't cause the workflow itself to fail —
they're reported in `LATEST.md` so you see them in context alongside
the other checks.

## Running locally

```bash
python3 scripts/audit_repo.py
```

Writes `LATEST.md` and `HISTORY.md` in this directory. Takes ~5–30s
depending on whether `node_modules` is installed (vitest will be
skipped with a `SKIP` status if it isn't).

## Cost + safety

- **Runtime cap**: the workflow has a 10-minute hard timeout.
- **Concurrency**: overlapping runs are disabled — if one hour's
  audit is still running when the next is scheduled, the next is
  skipped rather than stacked.
- **Scope**: the workflow has `contents: write` permission only to
  commit the two report files in this directory. It cannot touch
  any other files.
- **No side effects**: the audit script never modifies source, never
  regenerates `public/data/`, never pushes to branches other than the
  one it was triggered on, and only commits if the report files
  actually changed (so green-state runs with no data change produce
  no commit noise).

## What this audit is *not*

This is an **audit**, not an **improvement agent**. It finds problems
and reports them. It does not:

- Fix bugs
- Refactor code
- Modify UI/UX
- Regenerate data files
- Open PRs or issues
- Deploy anything

If you want a scheduled job that *actually changes* the repo (e.g.
regenerate `public/data/*.json` from the pipeline), that's a separate
workflow with its own review gates. Don't layer it onto this one.
