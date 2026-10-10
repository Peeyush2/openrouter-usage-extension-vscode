# OpenRouter Usage

Monitor OpenRouter spending and remaining limits from VS Code's status bar and Explorer sidebar.

## Get started

1. Install the generated `openrouter-usage-0.0.2.vsix` using **Extensions → ⋯ → Install from VSIX…**, or press **F5** in this project to run **Run Extension** in an Extension Development Host.
2. In the window running the extension, open the Command Palette (**Ctrl+Shift+P**) and run **OpenRouter Usage: Set API Key**.
3. Paste your key into the masked VS Code input, not into chat. Use the same key your OpenRouter clients use: key usage is specific to that key.
4. Click the **OR** status-bar item or expand **OpenRouter Usage** in Explorer for details. Refresh is automatic every 60 seconds by default.

The key is validated before it replaces a saved key. Cancelling leaves the previous key unchanged.

## What it shows

- API key spending cap, used amount and percentage for the current cap period, remaining key credits, and reset period.
- All-time spending and current UTC day, week (Monday start), and month spending, when reported by OpenRouter.
- External BYOK spending separately, including whether it counts toward the key's cap.
- Free-model daily request usage, ceiling, and remaining requests **only when returned by the API**.
- Optional account-wide credits purchased, credits used, and remaining balance.
- Last successful refresh time, stale-data indicators, and status-bar highlights at the configured cap threshold.

Amounts are USD credit values, not token counts or a VS Code/Copilot subscription quota. A key with no spending cap is **not** an unlimited account balance. The current cap calculation uses the API's `limit_remaining`, rather than confusing lifetime spending with a resetting limit.

### Account balance is optional

Run **OpenRouter Usage: Set Management Key (Account Credits)** to add a separate management key. OpenRouter's account-credit endpoint requires this stronger credential; an ordinary inference key is sufficient for its own spending and limits. Do not add a management key if key-level monitoring is all you need.

### Free-model limits

The daily request counter is an OpenRouter-reported account counter and may not be an enforced ceiling for exempt accounts/endpoints or BYOK. If OpenRouter omits it, the extension says the counter is unavailable rather than estimating it from spending. A live per-minute request counter and in-flight spending-budget balance are not exposed by these endpoints.

## Commands

All commands are grouped under **OpenRouter Usage** in the Command Palette:

- **Set API Key** / **Remove API Key**
- **Set Management Key (Account Credits)** / **Remove Management Key**
- **Refresh Usage** / **Show Usage** / **Open Dashboard**

## Settings

| Setting                                   | Default | Description                                      |
| ----------------------------------------- | ------- | ------------------------------------------------ |
| `openrouterUsage.refreshIntervalSeconds`  | `60`    | Automatic refresh interval, 15–3600 seconds.     |
| `openrouterUsage.autoRefresh`             | `true`  | Enable periodic requests.                        |
| `openrouterUsage.showStatusBar`           | `true`  | Show the OR status-bar item.                     |
| `openrouterUsage.warningThresholdPercent` | `80`    | Highlight when this much of the key cap is used. |

These settings are application-scoped, so a repository cannot override the polling policy. API keys are never settings.

## Security and privacy

- Credentials are saved only in **VS Code SecretStorage** and sent as bearer tokens to fixed OpenRouter HTTPS endpoints: `GET /api/v1/key` and, optionally, `GET /api/v1/credits`.
- No prompts, source code, inference requests, telemetry, or credentials are logged or sent to other services by this extension.
- HTTP redirects are rejected. Requests time out after 15 seconds; overlapping refreshes are coalesced.
- HTTP errors are sanitized, rate limits respect `Retry-After`, and automatic authentication retries stop until credentials change or you refresh manually.
- Removing a saved key clears its displayed data. Changing a key cancels old requests and discards their results.
- The extension runs locally in desktop VS Code, including with remote/virtual workspaces. Browser-only VS Code is not supported.

## Development

Requirements: desktop VS Code matching the `engines.vscode` range in `package.json`, Node.js 22+ (24 recommended), and npm. Run npm scripts using the VS Code task runner or npm scripts view:

| Script         | Purpose                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| `compile`      | Type-check, lint, and bundle the extension.                                           |
| `watch`        | Watch TypeScript and the esbuild bundle.                                              |
| `test:unit`    | Offline API/usage tests with mocked HTTP responses.                                   |
| `test`         | Full tests in an isolated Extension Development Host; downloads a VS Code test build. |
| `package:vsix` | Build an installable local VSIX.                                                      |

Press **F5** and choose **Run Extension** to debug. The default build task starts both watchers. No API key is required for the automated tests. Tests use synthetic credentials and mocked responses; they do not verify your live account balance.

The publisher `local` is for local packaging, not a Marketplace identity. Before publishing, replace it with your registered publisher ID and supply repository metadata.

## Troubleshooting

- **Invalid/expired key:** set a replacement key. Validation failures preserve the saved key.
- **Account credits require a management key:** add the optional management credential, or leave account monitoring unconfigured.
- **Stale values:** the last successful result stays visible with a warning after a failed refresh. Try again after the cooldown, or check your connection.
- **Missing usage fields:** OpenRouter did not report those values; missing values are not displayed as zero.
- **Different totals across clients:** make sure the monitored inference key is the one those clients actually use. Account totals and per-key totals have different scopes.

## License

MIT. This is an independent extension, not an official OpenRouter product.
