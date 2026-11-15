# Contributing to Fuelstat

First of all, thank you for your interest in contributing to **Fuelstat**!

Fuelstat is an open-source vehicle tracking and expense management application. Contributions of all kinds are welcome, including bug reports, feature requests, documentation improvements, translations, and code contributions.

This document explains how to contribute to the project.

## Table of Contents

- [Before You Start](#before-you-start)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Database Changes](#database-changes)
- [Pull Requests](#pull-requests)
- [Code Guidelines](#code-guidelines)
- [Security Issues](#security-issues)
- [License](#license)

## Before You Start

Before submitting a contribution:

1. Check the existing [issues](https://github.com/FuelStat/fuelstat/issues) to see whether the problem or feature has already been reported.
2. For significant changes, open an issue first to discuss the proposed implementation.
3. Keep contributions focused. Smaller, clearly scoped pull requests are easier to review and maintain.

Please do not open pull requests for changes that have not been discussed if they significantly affect the architecture, database structure, or application behavior.

## Reporting Bugs

Bug reports are an important part of improving Fuelstat.

Please use the GitHub issue tracker and include as much relevant information as possible:

- A clear and descriptive title.
- A description of the problem.
- Steps to reproduce the issue.
- Expected behavior.
- Actual behavior.
- Browser, operating system, and application version, where relevant.
- Relevant error messages or logs.

Please remove personal information, access tokens, passwords, and other sensitive data before sharing logs or screenshots.

## Suggesting Features

Feature requests are welcome!

When suggesting a new feature, please explain:

- What problem does the feature solve?
- Who would benefit from it?
- How should it work?
- Are there alternative solutions?

Feature requests should focus on the actual user benefit rather than prescribing a specific technical implementation.

## Development Setup

Fuelstat consists of a PHP-based web application and supporting backend services.

The project uses technologies including:

- PHP
- PostgreSQL
- Node.js
- Docker Compose
- Bootstrap
- JavaScript
- Chart.js

For local development, use the instructions provided in the repository's README and the relevant configuration files.

**Important:**

- Never use production credentials or production data in your development environment.
- Use separate development configuration and environment variables.
- Never commit secrets, API keys, passwords, private certificates, or personal data.
- Do not modify production configuration files as part of a contribution.

## Making Changes

We recommend the following workflow:

1. Fork the repository.
2. Create a dedicated feature or bugfix branch.
3. Make your changes.
4. Test your changes locally.
5. Commit your changes with a descriptive commit message.
6. Open a pull request against the `main` branch.

Use descriptive branch names, for example:

- `feature/vehicle-comparison`
- `feature/export-improvements`
- `fix/consumption-calculation`
- `fix/mobile-layout`

Keep each pull request focused on one feature or issue whenever possible.

## Database Changes

Changes to the database require particular care.

If your contribution changes the database structure or existing data:

- Provide a migration script where necessary.
- Follow the existing migration naming and numbering conventions.
- Ensure migrations are safe to execute in the intended deployment workflow.
- Avoid destructive changes unless absolutely necessary.
- Consider existing installations and user data.
- Never assume that a database is empty.
- Document any required migration steps.

Database changes must not silently delete or overwrite existing user data.

## Pull Requests

Before submitting a pull request, make sure that:

- [ ] The changes have been tested locally.
- [ ] Existing functionality has not been unintentionally broken.
- [ ] The implementation follows the project's existing conventions.
- [ ] Database migrations are included where necessary.
- [ ] Documentation has been updated where appropriate.
- [ ] No secrets, credentials, or personal data are included.
- [ ] The pull request has a clear description of the changes.
- [ ] Related issues are referenced where applicable.
- [ ] User-visible changes have an entry under `## [Unreleased]` in `CHANGELOG.md` (category: Neu, Verbessert, Behoben, Sicherheit, Technik). Operator notes for deployments (one-off commands, `.env` settings) go to `docs/update-hinweise.md` under `## [Unreleased]`, not into the changelog.

Pull requests should explain:

- What has changed?
- Why was the change necessary?
- How can the changes be tested?
- Are there any known limitations or side effects?

Pull requests may be reviewed, discussed, or adjusted before being merged.

The project maintainers reserve the right to request changes or decline contributions that do not fit the project's direction, quality standards, or security requirements.

## Code Guidelines

Please follow these general principles:

### General

- Keep code readable, maintainable, and consistent with the existing project.
- Prefer simple solutions over unnecessary complexity.
- Avoid duplicating existing functionality.
- Do not introduce dependencies without a good reason.
- Handle errors explicitly and avoid silently ignoring failures.

### PHP and Backend

- Follow the existing PHP coding style and architecture.
- Validate and sanitize user input.
- Use parameterized database queries.
- Apply appropriate authorization checks.
- Do not expose internal errors, credentials, or sensitive information to users.

### JavaScript and Frontend

- Keep the user interface consistent with the existing design.
- Ensure that new features work on desktop and mobile devices.
- Consider both browser and installed PWA usage.
- Avoid unnecessary dependencies and excessive client-side processing.

### Security and Privacy

- Follow secure coding practices.
- Apply the principle of least privilege.
- Do not expose user-specific data across accounts.
- Protect authentication and session handling.
- Consider security implications when introducing new functionality.

## Security Issues

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a potential security vulnerability, report it privately using GitHub Security Advisories:

[Report a vulnerability](https://github.com/FuelStat/fuelstat/security/advisories/new)

For further information, see the repository's [SECURITY.md](https://github.com/FuelStat/fuelstat/blob/main/SECURITY.md).

## License

By contributing to Fuelstat, you agree that your contributions will be licensed under the same license as the project.

Please make sure that you have the right to submit the code or other material you contribute.

Do not submit code copied from incompatible licenses or proprietary sources.

---

Thank you for helping make Fuelstat better!

Every contribution, no matter how small, is appreciated.

**Fuelstat**  
[GitHub Repository](https://github.com/FuelStat/fuelstat)
