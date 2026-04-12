#!/usr/bin/env python3
"""
audit_repo.py — hourly audit + health check for the opulence-dashboard.

Designed to run on GitHub Actions via .github/workflows/hourly-audit.yml.
Produces:

    .github/audit/LATEST.md    — full markdown report, overwritten each run
    .github/audit/HISTORY.md   — one-line summary per run, trimmed to last
                                  168 entries (7 days × 24 hours)

Sections of the report:

    1. Summary status line (everything green, yellow, or red)
    2. Test suite results (pytest + vitest if available)
    3. JSON schema validation over public/data/*.json
    4. Pipeline parity (export_data vs rebuild_dashboard_data on a fixture)
    5. API endpoint gap analysis (fetch() targets vs what the worker serves)
    6. Data freshness (age of summary.json's updated_at)
    7. Production health check (optional — only if DASHBOARD_URL env is set)
    8. Recent commits (last 5 on the current branch)

Design constraints:
    - Zero side effects on the working tree beyond writing the two report
      files. The workflow does the `git add + commit` step separately.
    - Must succeed (exit 0) even when individual checks fail — a red
      check is part of the report, not a reason for the audit itself
      to abort. The only non-zero exit is if the script itself crashes.
    - No network required for the core report. Health checks only fire
      when DASHBOARD_URL is set, and they time out fast.
    - Pure stdlib where possible. Falls back to `python3 -m pytest` via
      subprocess rather than importing pytest directly, so the script
      can be read standalone.

Kill switch:
    Create the file `.github/audit/DISABLED` in the repo and the workflow
    will skip this script entirely. Remove it to re-enable. The script
    itself also honors this file and exits early if it exists — useful
    when running locally.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# ─────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────

ROOT       = Path(__file__).resolve().parent.parent
AUDIT_DIR  = ROOT / ".github" / "audit"
LATEST_MD  = AUDIT_DIR / "LATEST.md"
HISTORY_MD = AUDIT_DIR / "HISTORY.md"
DISABLED   = AUDIT_DIR / "DISABLED"

# Trim HISTORY.md to this many most-recent rows (one week at hourly).
HISTORY_KEEP = 168

# Optional production URL (set via GitHub secret / repo variable).
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "").rstrip("/")

# Endpoints to probe when health-checking. These are the ones that
# should always resolve — anything else is best-effort.
HEALTH_PATHS = [
    "/",
    "/data/bundle.json",
    "/api/deals",
    "/api/arbitrage",
    "/api/summary",
    "/api/refs",
]

# ─────────────────────────────────────────────────────────────
# Tiny check framework — each check returns (status, headline, detail)
# where status is one of "ok" | "warn" | "fail" | "skip".
# ─────────────────────────────────────────────────────────────

STATUS_ICON = {
    "ok":   "OK",
    "warn": "WARN",
    "fail": "FAIL",
    "skip": "SKIP",
}


def _run(cmd, cwd=ROOT, timeout=300):
    """Run a subprocess and return (returncode, stdout, stderr)."""
    try:
        r = subprocess.run(
            cmd, cwd=str(cwd), capture_output=True, text=True,
            timeout=timeout, check=False,
        )
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout after {timeout}s"
    except FileNotFoundError as e:
        return 127, "", f"command not found: {e}"


# ─────────────────────────────────────────────────────────────
# Checks
# ─────────────────────────────────────────────────────────────

def check_pytest():
    rc, out, err = _run([sys.executable, "-m", "pytest", "-q", "--no-header"])
    if rc == 0:
        # "144 passed in 2.20s"
        m = re.search(r"(\d+) passed", out)
        count = m.group(1) if m else "?"
        return "ok", f"pytest: {count} passed", out.strip().splitlines()[-5:]
    # Capture a useful tail
    tail = (out + err).strip().splitlines()[-20:]
    return "fail", "pytest: FAILED", tail


def check_vitest():
    if not (ROOT / "node_modules" / ".package-lock.json").exists() and \
       not (ROOT / "node_modules" / "vitest").exists():
        return "skip", "vitest: node_modules not installed", []
    rc, out, err = _run(["npx", "--no", "vitest", "run", "--reporter=dot"], timeout=600)
    combined = out + err
    if rc == 0:
        m = re.search(r"Tests\s+(\d+) passed", combined)
        count = m.group(1) if m else "?"
        return "ok", f"vitest: {count} passed", combined.strip().splitlines()[-5:]
    tail = combined.strip().splitlines()[-20:]
    return "fail", "vitest: FAILED", tail


def check_schemas():
    """
    Re-run the existing schema-validation test module. If pytest
    already ran in this audit, this is redundant but cheap; it's
    here so a user running `python3 scripts/audit_repo.py` without
    the rest of the suite still gets schema validation.
    """
    rc, out, err = _run([sys.executable, "-m", "pytest", "-q", "--no-header",
                         "tests/test_data_schemas.py"])
    if rc == 0:
        m = re.search(r"(\d+) passed", out)
        return "ok", f"schemas: {m.group(1) if m else '?'} data files valid", []
    return "fail", "schemas: validation failed", (out + err).strip().splitlines()[-15:]


def check_parity():
    rc, out, err = _run([sys.executable, "-m", "pytest", "-q", "--no-header",
                         "tests/test_parity.py"])
    if rc == 0:
        return "ok", "parity: export_data <-> rebuild_dashboard_data agree", []
    return "fail", "parity: pipelines disagree", (out + err).strip().splitlines()[-15:]


def check_endpoint_gaps():
    """
    Enumerate /api/* fetch() targets from public/index.html and modules,
    then compare against what src/worker.js can actually serve:
        - static /data/{key}.json files
        - KV keys (assumed to mirror the static file names in a Pages
          deploy unless the user manually populates KV)

    Reports the total count, the count that have no static backing, and
    the top 10 missing endpoints by name so the report is actionable.
    """
    targets = set()
    patterns_to_scan = [
        ROOT / "public" / "index.html",
    ]
    for m in (ROOT / "public" / "modules").glob("*.js"):
        patterns_to_scan.append(m)

    # Match fetch('/api/...') / fetch("/api/...") / fetch(`/api/...`)
    fetch_rx = re.compile(r"""fetch\(\s*[`'"](/api/[^`'"\s)]+)""")
    for p in patterns_to_scan:
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for m in fetch_rx.finditer(text):
            url = m.group(1)
            # Strip ?query string, ${template}, and trailing segments
            # after the first ${ so we compare by base key only.
            url = url.split("?")[0].split("${")[0].rstrip("/")
            # Everything after /api/ becomes the static key candidate
            key = url.replace("/api/", "")
            if key:
                targets.add(key)

    # What's actually servable from the Pages deploy
    data_dir = ROOT / "public" / "data"
    static_keys = {p.stem for p in data_dir.glob("*.json")}

    # Top-level keys that resolve: path.startswith one of the static
    # file stems (e.g. `inventory/all` won't match `inventory` because
    # the worker does `/data/inventory/all.json`, not `/data/inventory`).
    missing = sorted(k for k in targets if k not in static_keys)

    total = len(targets)
    resolved = total - len(missing)
    pct = (resolved / total * 100) if total else 0

    # Show the first 10 missing endpoints so the report is concrete
    sample = missing[:10]
    detail = [f"- `/api/{m}`" for m in sample]
    if len(missing) > 10:
        detail.append(f"- …and {len(missing) - 10} more")

    status = "ok" if not missing else ("warn" if pct > 50 else "fail")
    headline = f"api-gap: {resolved}/{total} endpoints resolvable ({pct:.0f}%)"
    return status, headline, detail


def check_data_freshness():
    """How old is public/data/summary.json's updated_at?"""
    f = ROOT / "public" / "data" / "summary.json"
    if not f.exists():
        return "warn", "freshness: summary.json missing", []
    try:
        updated_at = json.loads(f.read_text())["updated_at"]
        ts = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    except Exception as e:
        return "warn", f"freshness: could not parse updated_at ({e})", []
    age_hours = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
    if age_hours > 48:
        status = "fail"
    elif age_hours > 12:
        status = "warn"
    else:
        status = "ok"
    return status, f"freshness: data is {age_hours:.1f}h old", [f"updated_at: {updated_at}"]


def check_health():
    """
    Probe HEALTH_PATHS against DASHBOARD_URL. Only fires if
    DASHBOARD_URL is set. Uses a short timeout so a dead origin
    doesn't hang the audit.
    """
    if not DASHBOARD_URL:
        return "skip", "health: DASHBOARD_URL not set (set repo variable to enable)", []
    results = []
    fails = 0
    for path in HEALTH_PATHS:
        url = DASHBOARD_URL + path
        start = time.monotonic()
        try:
            req = Request(url, headers={"User-Agent": "mk-audit/1.0"})
            with urlopen(req, timeout=10) as resp:
                status = resp.status
                elapsed_ms = int((time.monotonic() - start) * 1000)
                marker = "OK" if 200 <= status < 400 else "BAD"
                if marker == "BAD":
                    fails += 1
                results.append(f"- [{marker}] {status} {elapsed_ms}ms `{path}`")
        except HTTPError as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            fails += 1
            results.append(f"- [BAD] {e.code} {elapsed_ms}ms `{path}` — {e.reason}")
        except URLError as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            fails += 1
            results.append(f"- [NET] {elapsed_ms}ms `{path}` — {e.reason}")
        except Exception as e:
            fails += 1
            results.append(f"- [ERR] `{path}` — {e}")
    total = len(HEALTH_PATHS)
    ok = total - fails
    if fails == 0:
        status = "ok"
    elif ok >= total // 2:
        status = "warn"
    else:
        status = "fail"
    return status, f"health: {ok}/{total} endpoints OK at {DASHBOARD_URL}", results


def check_recent_commits():
    rc, out, _ = _run(["git", "log", "--oneline", "-5"])
    if rc != 0:
        return "skip", "git log unavailable", []
    return "ok", "recent commits", [f"- `{line}`" for line in out.strip().splitlines()]


# ─────────────────────────────────────────────────────────────
# Report rendering
# ─────────────────────────────────────────────────────────────

CHECKS = [
    ("Tests (pytest)",      check_pytest),
    ("Tests (vitest)",      check_vitest),
    ("Data schemas",        check_schemas),
    ("Pipeline parity",     check_parity),
    ("API endpoint gaps",   check_endpoint_gaps),
    ("Data freshness",      check_data_freshness),
    ("Production health",   check_health),
    ("Recent commits",      check_recent_commits),
]


def run_all():
    now = datetime.now(timezone.utc)
    rows = []
    for name, fn in CHECKS:
        try:
            status, headline, detail = fn()
        except Exception as e:
            status, headline, detail = "fail", f"{name}: check crashed ({e})", []
        rows.append((name, status, headline, detail))
    return now, rows


def render_latest(now, rows):
    # Overall status: any FAIL -> fail; any WARN -> warn; else ok
    overall = "ok"
    for _, status, *_ in rows:
        if status == "fail":
            overall = "fail"
            break
        if status == "warn" and overall != "fail":
            overall = "warn"

    lines = [
        f"# Audit — {now.isoformat(timespec='seconds')}",
        "",
        f"**Overall**: `{STATUS_ICON[overall]}`",
        "",
        "| Check | Status | Headline |",
        "|---|---|---|",
    ]
    for name, status, headline, _ in rows:
        lines.append(f"| {name} | `{STATUS_ICON[status]}` | {headline} |")

    lines.append("")
    lines.append("## Details")
    lines.append("")
    for name, status, headline, detail in rows:
        lines.append(f"### {name} — `{STATUS_ICON[status]}`")
        lines.append("")
        lines.append(f"> {headline}")
        lines.append("")
        if detail:
            for d in detail:
                lines.append(d if d.startswith(("-", "`", "#")) else f"    {d}")
            lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("Generated by `scripts/audit_repo.py`. To disable, create `.github/audit/DISABLED`.")
    return "\n".join(lines) + "\n", overall


def append_history(now, overall, rows):
    """
    One-line summary per run, appended and trimmed to the last
    HISTORY_KEEP entries.
    """
    # Compact single-line row
    ts = now.isoformat(timespec="minutes")
    parts = []
    for name, status, headline, _ in rows:
        short = name.lower().replace(" ", "-").replace("(", "").replace(")", "")
        parts.append(f"{short}={STATUS_ICON[status]}")
    header = f"| {ts} | {STATUS_ICON[overall]} | " + " ".join(parts) + " |"

    existing = []
    if HISTORY_MD.exists():
        existing = HISTORY_MD.read_text().splitlines()

    # Strip old header/table header; rebuild fresh each write so the
    # table always validates
    data_rows = [ln for ln in existing if ln.startswith("| 2")]
    data_rows.append(header)
    data_rows = data_rows[-HISTORY_KEEP:]

    out = [
        "# Audit history",
        "",
        "One row per hourly audit run. Trimmed to the last "
        f"{HISTORY_KEEP} entries (~{HISTORY_KEEP // 24} days).",
        "",
        "| Time (UTC) | Overall | Checks |",
        "|---|---|---|",
    ] + data_rows + [""]
    return "\n".join(out)


# ─────────────────────────────────────────────────────────────
# Entrypoint
# ─────────────────────────────────────────────────────────────

def main():
    if DISABLED.exists():
        print("audit: kill switch active (.github/audit/DISABLED exists) — exiting")
        return 0

    AUDIT_DIR.mkdir(parents=True, exist_ok=True)

    now, rows = run_all()
    report, overall = render_latest(now, rows)
    LATEST_MD.write_text(report)
    HISTORY_MD.write_text(append_history(now, overall, rows))

    # Print a short summary to stdout so the workflow log is useful.
    print(f"audit: overall={overall}")
    for name, status, headline, _ in rows:
        print(f"  [{STATUS_ICON[status]:4}] {headline}")

    # Always exit 0 — a red check should land in the report, not
    # blow up the workflow. The workflow can be configured to ping
    # on-call separately by reading LATEST.md.
    return 0


if __name__ == "__main__":
    sys.exit(main())
