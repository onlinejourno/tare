# Contributing

Thanks for considering a contribution. This is a fully open-source (MIT) tool,
built by a journalist for journalists — contributions are genuinely welcome.

## Why this project exists

It measures something newsrooms and readers care about, from a journalist's
point of view, using only public data. If that resonates, you're in the right
place.

## Ways to contribute

- **Report a bug** — open an issue with steps to reproduce.
- **Improve detection accuracy** — if the tool mis-scores a real site, tell us
  what it got wrong and why (a URL and the expected result help a lot).
- **Extend the data** — the detection rules live in the repo; PRs that add or
  correct entries are welcome. Cite a source for any new entry.
- **Docs** — clarify the README, add examples, fix typos.

## Good first issues

Issues labelled `good first issue` are scoped to be completable in an afternoon
and have enough context to start without deep knowledge of the codebase.

## Running locally

See the README's "Run locally" section. Please make sure the existing test
suite passes before opening a PR:

```
# Node projects:  npm test
# Python projects: pytest
```

## Pull requests

- Keep PRs focused — one concern per PR.
- Add or update a test for any behaviour change.
- Match the existing code style; no new top-level dependencies without a note
  explaining why.
- Describe **what** changed and **why** in the PR description.

## Conduct & security

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
For security issues, follow [SECURITY.md](SECURITY.md) — do not open a public
issue.

## Licence

By contributing, you agree that your contributions are licensed under the
repository's MIT licence.
