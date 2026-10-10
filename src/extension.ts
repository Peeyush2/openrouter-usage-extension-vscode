import * as vscode from 'vscode';
import { OpenRouterClient, validateApiKey } from './api';
import { validateAndSaveKey } from './credentials';
import { apiKeySecret, managementKeySecret, safeError, UsageMonitor } from './monitor';
import { updateStatusBar, UsageView } from './usageView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const client = new OpenRouterClient();
	const monitor = new UsageMonitor(context.secrets, client);
	const provider = new UsageView();
	const view = vscode.window.createTreeView('openrouterUsage.details', { treeDataProvider: provider });
	const statusBar = vscode.window.createStatusBarItem('openrouterUsage.status', vscode.StatusBarAlignment.Right, 100);
	statusBar.name = 'OpenRouter Usage';
	const update = () => {
		provider.update(monitor.state);
		updateStatusBar(statusBar, monitor.state);
	};
	let settingKey = false;
	const setKey = async (management: boolean) => {
		if (settingKey) { return; }
		settingKey = true;
		try {
			const input = await vscode.window.showInputBox({
				title: management ? 'OpenRouter management key (optional)' : 'OpenRouter API key',
				prompt: management
					? 'Enter a management key to read account-wide credit totals. Stored securely, not in settings.'
					: 'Enter the API key used by your OpenRouter clients to track its usage. Stored securely, not in settings.',
				password: true,
				ignoreFocusOut: true,
				validateInput: validateApiKey,
			});
			if (input === undefined) { return; }
			const key = input.trim();
			await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Validating OpenRouter key…' }, async () => {
				await validateAndSaveKey(client, context.secrets, management ? managementKeySecret : apiKeySecret, key, management);
			});
			await monitor.secretsChanged();
			const refreshError = management ? monitor.state.accountError : monitor.state.keyError;
			if (refreshError) {
				await vscode.window.showWarningMessage(`OpenRouter key saved, but usage could not refresh: ${refreshError}`);
			} else {
				await vscode.window.showInformationMessage('OpenRouter key validated and saved in VS Code secure storage.');
			}
		} catch (error) {
			await vscode.window.showErrorMessage(`OpenRouter: ${safeError(error)}`);
		} finally {
			settingKey = false;
		}
	};
	const removeKey = async (management: boolean) => {
		const choice = await vscode.window.showWarningMessage(
			`Remove the saved OpenRouter ${management ? 'management' : 'API'} key?`, { modal: true }, 'Remove');
		if (choice !== 'Remove') { return; }
		try {
			await context.secrets.delete(management ? managementKeySecret : apiKeySecret);
			await monitor.secretsChanged();
		} catch {
			await vscode.window.showErrorMessage('OpenRouter: Cannot remove the key from VS Code secure storage.');
		}
	};
	context.subscriptions.push(
		monitor, provider, view, statusBar,
		monitor.onDidChange(update),
		context.secrets.onDidChange(event => {
			if (!settingKey && (event.key === apiKeySecret || event.key === managementKeySecret)) { void monitor.secretsChanged(); }
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('openrouterUsage')) { monitor.configureTimer(); update(); }
		}),
		vscode.commands.registerCommand('openrouterUsage.setApiKey', () => setKey(false)),
		vscode.commands.registerCommand('openrouterUsage.setManagementKey', () => setKey(true)),
		vscode.commands.registerCommand('openrouterUsage.removeApiKey', () => removeKey(false)),
		vscode.commands.registerCommand('openrouterUsage.removeManagementKey', () => removeKey(true)),
		vscode.commands.registerCommand('openrouterUsage.refresh', async () => {
			await monitor.refresh(true);
			if (monitor.state.keyError || monitor.state.accountError) {
				await vscode.window.showWarningMessage(`OpenRouter: ${monitor.refreshErrorMessage()}`);
			} else if (!monitor.state.keyConfigured && !monitor.state.managementConfigured) {
				await setKey(false);
			}
		}),
		vscode.commands.registerCommand('openrouterUsage.showUsage', () => vscode.commands.executeCommand('openrouterUsage.details.focus')),
		vscode.commands.registerCommand('openrouterUsage.openDashboard', () => vscode.env.openExternal(vscode.Uri.parse('https://openrouter.ai/activity'))),
	);
	update();
	await monitor.start();
}
