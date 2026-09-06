# Contributing

RunWhale is an early-stage mobile development environment. Focused bug reports, documentation, tests, and code changes that strengthen its core mobile workflow are welcome.

## Ways to Contribute

- Report reproducible bugs through [GitHub Issues](https://github.com/zhiqingchen/RunWhale/issues).
- Improve documentation, diagnostics, tests, or confirmed behavior.
- Share feedback about creating, editing, testing, and previewing projects entirely on a phone.

## Before You Start

- Search existing issues before opening a new one.
- Open an issue before starting a substantial behavior, runtime, or native change.
- Keep each pull request focused on one cohesive problem.
- Prefer the simplest implementation that satisfies the current requirement.
- Never include credentials, private repositories, private keys, project data, or unsanitized logs and screenshots.
- Credentials must not enter project files, environment variables, sessions, logs, bundles, or Preview.
- User projects must never trigger Xcode, Gradle, EAS, IPA, or APK builds.

## Pull Requests

Follow the setup and validation guidance in [DEVELOPMENT.md](DEVELOPMENT.md). A pull request should include:

- A concise explanation of the problem and the chosen solution.
- The focused checks and device validation that were run.
- Sanitized screenshots or recordings for visible UI changes when they materially help review.
- Any remaining limitation or external prerequisite that could not be validated.

Do not commit build outputs, credentials, device-specific logs, temporary test or audit reports, task progress notes, validation screenshots or recordings, or unrelated changes. Put validation evidence and remaining limitations in the pull request description; delete temporary local artifacts when no longer needed. Keep test coverage proportional to the confirmed risk.

## License and Name

RunWhale's original software code is distributed under the [Apache License 2.0](LICENSE). Contributions intentionally submitted for inclusion are provided under the same terms unless explicitly agreed otherwise.

The software license does not grant rights to use the `RunWhale` name as a trade name, trademark, service mark, or product name, except for reasonable and customary use when describing the origin of the software.
