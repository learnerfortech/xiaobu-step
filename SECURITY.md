# Security policy

## Current deployment boundary

Xiaobu Step is currently a local-first, single-family prototype. The documented setup is for macOS on a trusted home network. It is not a hosted multi-family service.

The LAN server listens on `0.0.0.0` (default port `8766`) and checks the request host, origin, and whether the client address is private. These checks restrict the intended network boundary; **they are not user authentication**. The current parent/child route distinction must not be treated as an identity or permission system.

Until server-side authentication and authorization are implemented and tested:

- Run Xiaobu only on a trusted private home LAN.
- Do not use it on public, guest, school, workplace, or otherwise shared networks.
- Do not configure router port forwarding, expose port `8766` to the public Internet, or put the service behind a public reverse proxy.
- Do not use the current server as a multi-family or commercial hosted service.
- Keep real family data, photos, databases, and backups outside this public repository.

A device that can join the same trusted LAN may be able to call parent-side API routes. Treat all devices on that LAN as trusted.

## Reporting a vulnerability

Please do not publish credentials, children's information, private photos, database files, or detailed exploit instructions in a public issue.

If GitHub's private vulnerability reporting is enabled for this repository, use **Security → Report a vulnerability**. Otherwise, contact the repository maintainer through their GitHub profile and request a private reporting channel before sharing technical details.

## If you suspect data exposure

Stop the service, remove it from the affected network, preserve the relevant local evidence privately, and rotate any credentials that may have been exposed. Removing a file from the latest commit does not remove it from Git history or existing clones.
