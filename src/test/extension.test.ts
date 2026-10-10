import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { OpenRouterClient } from '../api';
import { apiKeySecret, managementKeySecret, UsageMonitor } from '../monitor';
import { UsageView } from '../usageView';

function fakeSecrets(values: Record<string, string> = {}): vscode.SecretStorage {
	return {
		get: async name => values[name],
		keys: async () => Object.keys(values),
		store: async (name, value) => { values[name] = value; },
		delete: async name => { delete values[name]; },
		onDidChange: () => new vscode.Disposable(() => { }),
	};
}

suite('VS Code integration', () => {
	test('Registers all extension commands without needing an API key', async () => {
		const extension = vscode.extensions.getExtension('local.openrouter-usage');
		assert.ok(extension);
		await extension.activate();
		const commands = await vscode.commands.getCommands(true);
		for (const name of ['setApiKey', 'setManagementKey', 'removeApiKey', 'removeManagementKey', 'refresh', 'showUsage', 'openDashboard']) {
			assert.ok(commands.includes(`openrouterUsage.${name}`), name);
		}
	});

	test('Makes no network requests without saved keys', async () => {
		let calls = 0;
		const monitor = new UsageMonitor(fakeSecrets(), new OpenRouterClient(async () => { calls++; throw new Error('unexpected'); }));
		try { await monitor.start(); assert.equal(calls, 0); } finally { monitor.dispose(); }
	});

	test('Reads key and account usage independently', async () => {
		const monitor = new UsageMonitor(fakeSecrets({ [apiKeySecret]: 'test-only-key', [managementKeySecret]: 'test-only-management' }),
			new OpenRouterClient(async url => String(url).endsWith('/key')
				? Response.json({ data: { usage: 4, limit: 10, limit_remaining: 6 } })
				: new Response(null, { status: 403 })));
		try {
			await monitor.refresh();
			assert.equal(monitor.state.key?.usage, 4);
			assert.equal(monitor.state.keyError, undefined);
			assert.match(monitor.state.accountError ?? '', /management key/);
		} finally { monitor.dispose(); }
	});

	test('Keeps successful data marked stale after a refresh failure', async () => {
		let calls = 0;
		const monitor = new UsageMonitor(fakeSecrets({ [apiKeySecret]: 'test-only-key' }), new OpenRouterClient(async () => {
			calls++;
			return calls === 1 ? Response.json({ data: { usage: 4, limit: null } }) : new Response(null, { status: 500 });
		}));
		try {
			await monitor.refresh();
			await monitor.refresh();
			assert.equal(monitor.state.key?.usage, 4);
			assert.match(monitor.state.keyError ?? '', /HTTP 500/);
			assert.ok(monitor.state.keyUpdatedAt);
		} finally { monitor.dispose(); }
	});

	test('Coalesces concurrent refreshes and respects rate-limit cooldown even on manual refresh', async () => {
		let calls = 0;
		const monitor = new UsageMonitor(fakeSecrets({ [apiKeySecret]: 'test-only-key' }), new OpenRouterClient(async () => {
			calls++;
			return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
		}));
		try {
			const first = monitor.refresh();
			assert.equal(first, monitor.refresh());
			await first;
			await monitor.refresh(true);
			assert.equal(calls, 1);
			assert.match(monitor.refreshErrorMessage(), /Retry available in \d+ seconds/);
		} finally { monitor.dispose(); }
	});

	test('Discards a late response after credentials change', async () => {
		let resolveResponse!: (response: Response) => void;
		let notifyStarted!: () => void;
		const started = new Promise<void>(resolve => { notifyStarted = resolve; });
		const secrets = fakeSecrets({ [apiKeySecret]: 'test-only-key' });
		const monitor = new UsageMonitor(secrets, new OpenRouterClient(async () => {
			notifyStarted();
			return new Promise<Response>(resolve => { resolveResponse = resolve; });
		}));
		try {
			const oldRequest = monitor.refresh();
			await started;
			await secrets.delete(apiKeySecret);
			await monitor.secretsChanged();
			resolveResponse(Response.json({ data: { usage: 4, limit: null } }));
			await oldRequest;
			assert.equal(monitor.state.key, undefined);
			assert.equal(monitor.state.keyConfigured, false);
		} finally { monitor.dispose(); }
	});

	test('Shows welcome content before configuration and never displays raw key labels', () => {
		const provider = new UsageView();
		try {
			assert.equal(provider.getChildren().length, 0);
			provider.update({
				keyConfigured: true, managementConfigured: false, refreshing: false,
				key: { label: 'sensitive-key-label', usage: 4, limit: null, includeByokInLimit: false }
			});
			const rows = provider.getChildren();
			assert.ok(rows.some(row => row.label === 'API key limit'));
			assert.doesNotMatch(JSON.stringify(rows), /sensitive-key-label/);
		} finally { provider.dispose(); }
	});

	test('A management-key read failure cannot block API-key usage', async () => {
		const secrets = fakeSecrets();
		secrets.get = async name => {
			if (name === managementKeySecret) { throw new Error('sensitive storage details'); }
			return 'test-only-key';
		};
		const monitor = new UsageMonitor(secrets, new OpenRouterClient(async () => Response.json({ data: { usage: 4, limit: null } })));
		try {
			await monitor.refresh();
			assert.equal(monitor.state.key?.usage, 4);
			assert.equal(monitor.state.keyError, undefined);
			assert.match(monitor.state.accountError ?? '', /management.*secure storage/);
			assert.doesNotMatch(monitor.state.accountError ?? '', /sensitive storage details/);
			assert.equal(monitor.state.refreshing, false);
		} finally { monitor.dispose(); }
	});

	test('An API-key read failure cannot block optional account credits', async () => {
		const secrets = fakeSecrets();
		secrets.get = async name => {
			if (name === apiKeySecret) { throw new Error('sensitive storage details'); }
			return 'test-only-management';
		};
		const monitor = new UsageMonitor(secrets, new OpenRouterClient(async () => Response.json({ data: { total_credits: 10, total_usage: 2 } })));
		try {
			await monitor.refresh();
			assert.equal(monitor.state.account?.totalCredits, 10);
			assert.equal(monitor.state.accountError, undefined);
			assert.match(monitor.state.keyError ?? '', /API.*secure storage/);
		} finally { monitor.dispose(); }
	});

	test('Storage read recovery clears errors even when keys are absent', async () => {
		let fail = true;
		const secrets = fakeSecrets();
		secrets.get = async () => { if (fail) { throw new Error('storage failed'); } return undefined; };
		const monitor = new UsageMonitor(secrets);
		try {
			await monitor.refresh();
			assert.ok(monitor.state.keyError);
			assert.ok(monitor.state.accountError);
			fail = false;
			await monitor.refresh();
			assert.equal(monitor.state.keyError, undefined);
			assert.equal(monitor.state.accountError, undefined);
			assert.equal(monitor.state.keyConfigured, false);
		} finally { monitor.dispose(); }
	});

	test('Management storage failure keeps account data visibly stale', async () => {
		let fail = false;
		const secrets = fakeSecrets();
		secrets.get = async name => {
			if (name === apiKeySecret) { return undefined; }
			if (fail) { throw new Error('storage failed'); }
			return 'test-only-management';
		};
		const monitor = new UsageMonitor(secrets, new OpenRouterClient(async () => Response.json({ data: { total_credits: 10, total_usage: 2 } })));
		const provider = new UsageView();
		try {
			await monitor.refresh();
			fail = true;
			await monitor.refresh();
			assert.equal(monitor.state.account?.totalCredits, 10);
			provider.update(monitor.state);
			assert.equal(provider.getChildren().find(item => item.label === 'Account credits · USD')?.description, 'Last successful data');
		} finally { monitor.dispose(); provider.dispose(); }
	});

	test('Shows optional-account storage errors even when neither key is configured', () => {
		const provider = new UsageView();
		try {
			provider.update({ keyConfigured: false, managementConfigured: false, refreshing: false, accountError: 'Cannot read management key' });
			assert.ok(provider.getChildren().some(item => item.label === 'Account credits unavailable'));
		} finally { provider.dispose(); }
	});
});
