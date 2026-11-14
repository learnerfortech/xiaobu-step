# Contributing to Xiaobu Step

Thanks for considering a contribution.

## Before opening an issue or pull request

- Search existing issues first.
- For a bug, include the smallest reproducible steps and the environment where it happened.
- For a feature idea, describe the family problem first; avoid proposing a large feature before the problem is clear.
- Keep changes small and focused. One pull request should solve one main problem.

## Privacy and safety

Never commit or attach real family data, children's names in combination with identifying details, school information, homework photos, voice recordings, local databases, backups, access tokens, API keys, or private logs.

Use synthetic examples. Redact screenshots and logs before sharing them.

Do not add third-party images, audio, fonts, or other media unless their source and redistribution license are documented in `ASSET_NOTICES.md`.

## Pull request checklist

Please include:

1. The problem being solved.
2. The files and behavior changed.
3. Tests or checks actually run, with results.
4. Known limitations and anything not tested.
5. Any data migration, privacy, security, or asset-licensing impact.

Do not describe code as tested, deployed, or production-ready unless that exact step was completed.

## Development checks

The repository's GitHub Actions workflow checks Python and JavaScript syntax, task/import behavior, frontend save and UI control logic, and an HTTP task lifecycle using temporary synthetic data. The HTTP tests use the production handler and LAN adapter; the Node UI tests use DOM stubs and do not run a browser.

Run `python -m unittest discover -s tests -v`, `node --test tests/test_task*.cjs`, and `python tests/browser_task_planning.py --http-only` for these behavior checks. Optional browser acceptance is `python tests/browser_task_planning.py` when Python Playwright and Chromium are available. Automated checks do not replace testing task, photo, and confirmation flows on a real device.

When changing runtime behavior, explain the manual test steps and the device/browser used.
