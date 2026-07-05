# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Report privately through GitHub's private vulnerability reporting:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected version/commit, and a reproduction if you
   have one.

If you cannot use GitHub's reporting flow, you may reach the maintainer through
the contact channel listed on https://onlinejourno.com/contact/.

## What to expect

- **Acknowledgement** within 5 working days.
- An initial assessment and, where confirmed, a planned fix window.
- Coordinated disclosure: we will agree a disclosure date with you and credit
  you unless you prefer to remain anonymous.

Please give us reasonable time to investigate and remediate before any public
disclosure.

## Scope

In scope: the code in this repository. Out of scope: third-party services,
dependencies (report those upstream), and any deployment you run yourself with
modified configuration.

## Handling of secrets

This repository should contain **no secrets**. Configuration is supplied at run
time via environment variables (see `.env.example` where present). If you
believe a credential has been committed, report it privately as above so it can
be rotated.
