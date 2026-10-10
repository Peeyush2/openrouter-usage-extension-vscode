# OpenRouter Usage development instructions

## Completed setup

- [x] Create project instructions.
- [x] Clarify requirements: a TypeScript VS Code extension monitoring OpenRouter usage.
- [x] Scaffold with the official VS Code generator, npm, and esbuild.
- [x] Implement secure keys, status-bar display, Explorer details, and automatic refresh.
- [x] Install the recommended esbuild Problem Matchers extension.
- [x] Compile and lint without errors; all 27 tests pass.
- [x] Create and run the Verify OpenRouter Usage task.
- [x] Handle launch: debug launch deferred because the user is unavailable; F5 is ready.
- [x] Complete README documentation and create the installable VSIX.

## Conventions

- Work from the project root. TypeScript source is in `src`; esbuild bundles to `dist/extension.js`.
- Keep user-facing explanations concise. Avoid unrelated integrations and media.
- Use stable VS Code APIs. Register lifecycle resources in `context.subscriptions`.
- Store credentials only in `ExtensionContext.secrets`; never in settings, logs, source files, chat, or tests.
- Make only read-only requests to the fixed OpenRouter HTTPS endpoints; reject redirects and preserve timeouts.
- Do not infer account balance or free request usage from per-key spending. Account credits need a separate optional management key.
- Prefer `limit_remaining` for cap calculations. Handle resetting limits, BYOK, missing fields, uncapped keys, and overspending.
- Mark retained data stale on failure. Respect cooldowns, coalesce requests, and discard obsolete credential responses.
- No inference requests or telemetry. Tests use synthetic credentials and mocked HTTP responses.

## Verification and packaging

- `npm run compile`: type-check, lint, and bundle.
- `npm run test:unit`: 20 offline tests.
- `npm test`: all 27 tests, including 7 extension-host tests.
- `npm run package:vsix`: creates `openrouter-usage-0.0.2.vsix`.
- The Verify OpenRouter Usage task builds and runs offline tests.
- F5 starts Run Extension using the default watch build task. Do not launch an interactive debug window without confirmation.
- Publisher `local` is for local installation, not a registered Marketplace publisher.
