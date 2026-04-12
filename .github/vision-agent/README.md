# Vision Improvement Agent

An hourly automated agent that continuously improves the watch
recognition system. Runs via `.github/workflows/hourly-vision-improve.yml`.

## What it does

Every hour, Claude Code runs with the prompt in `PROMPT.md` and picks
ONE of five focus areas to improve:

1. **Prompt engineering** — improve identification accuracy
2. **Cross-reference enrichment** — better market data matching
3. **Error handling** — reliability under edge cases
4. **Frontend UX** — usability improvements to the vision UI
5. **Test coverage** — catch regressions before they ship

Changes land on the `vision-improvements` branch, never directly on
main. Review and merge when ready.

## Scope constraints

The agent can ONLY modify:
- `public/_worker.js` + `src/worker.js` (vision routes, prompts)
- `scripts/watch_recognition.py` + `scripts/watch_recognition_server.py`
- `tests/test_watch_recognition.py` + `tests/js/worker.test.js`
- `public/index.html` (vision UI sections only)

It cannot touch modules, data files, other workflows, or unrelated code.

## Kill switch

```bash
touch .github/vision-agent/DISABLED
git add .github/vision-agent/DISABLED
git commit -m "vision-agent: disable"
git push
```

Delete the file to re-enable.

## Requirements

The workflow needs `ANTHROPIC_API_KEY` set as a repo secret for Claude
Code to run. The same key is used by the vision recognition itself.

## Branch strategy

- Agent works on `vision-improvements` branch
- Merges from `main` at the start of each run (stays current)
- All changes require human review before merging to `main`
- Each commit is atomic and explains what improved and why
