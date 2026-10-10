import * as vscode from 'vscode';
import { UsageState } from './monitor';
import { formatOptionalUsd, formatUsd, getLimitUsage } from './usage';

export class UsageItem extends vscode.TreeItem {
    constructor(label: string, value?: string, readonly children?: UsageItem[], icon?: string, command?: string, hint?: string) {
        super(label, children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        this.description = value;
        this.tooltip = hint ?? (value ? `${label}: ${value}` : label);
        if (icon) { this.iconPath = new vscode.ThemeIcon(icon); }
        if (command) { this.command = { command, title: label }; }
    }
}

export class UsageView implements vscode.TreeDataProvider<UsageItem>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<UsageItem | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    private state: UsageState = { keyConfigured: false, managementConfigured: false, refreshing: false };

    update(state: UsageState): void {
        this.state = state;
        this.emitter.fire(undefined);
    }

    getTreeItem(item: UsageItem): vscode.TreeItem { return item; }

    getChildren(item?: UsageItem): UsageItem[] {
        if (item) { return item.children ?? []; }
        const state = this.state;
        if (!state.keyConfigured && !state.managementConfigured && !state.keyError && !state.accountError && !state.refreshing) { return []; }
        const rows: UsageItem[] = [];
        if (state.refreshing) { rows.push(new UsageItem('Refreshing usage…', undefined, undefined, 'sync~spin')); }
        if (state.keyError) { rows.push(new UsageItem('Key usage unavailable', state.keyError, undefined, 'warning')); }
        if (state.key) {
            const key = state.key;
            const limit = getLimitUsage(key);
            const limits = [
                new UsageItem('Spending cap', key.limit === null ? 'No key cap' : formatUsd(key.limit)),
                new UsageItem('Used in cap period', limit ? `${formatUsd(limit.used)} (${limit.percent.toFixed(1)}%)` : 'Not reported'),
                new UsageItem('Remaining key credits', limit ? formatUsd(limit.remaining) : 'Not reported'),
                new UsageItem('Cap resets', key.limitReset === null ? 'Never' : key.limitReset ?? 'Not reported'),
                new UsageItem('BYOK included in cap', key.includeByokInLimit ? 'Yes' : 'No'),
            ];
            if (key.limit === null) {
                limits[1] = new UsageItem('Used in cap period', 'Not applicable');
                limits[2] = new UsageItem('Remaining key credits', 'Uncapped (account balance still applies)');
            }
            rows.push(new UsageItem('API key limit', state.keyError ? 'Last successful data' : undefined, limits, 'dashboard'));
            rows.push(new UsageItem('Key spending · USD', undefined, [
                new UsageItem('All time', formatUsd(key.usage)),
                new UsageItem('Today · UTC', formatOptionalUsd(key.usageDaily)),
                new UsageItem('This week · UTC', formatOptionalUsd(key.usageWeekly)),
                new UsageItem('This month · UTC', formatOptionalUsd(key.usageMonthly)),
            ], 'graph'));
            if (key.byokUsage !== undefined) {
                rows.push(new UsageItem('External BYOK spending · USD', undefined, [
                    new UsageItem('All time', formatUsd(key.byokUsage)),
                    new UsageItem('Today · UTC', formatOptionalUsd(key.byokUsageDaily)),
                    new UsageItem('This week · UTC', formatOptionalUsd(key.byokUsageWeekly)),
                    new UsageItem('This month · UTC', formatOptionalUsd(key.byokUsageMonthly)),
                ], 'plug'));
            }
            if (key.freeRequests) {
                rows.push(new UsageItem('Free-model requests · UTC day', undefined, [
                    new UsageItem('Used', `${key.freeRequests.used}`),
                    new UsageItem('Daily ceiling', `${key.freeRequests.limit}`),
                    new UsageItem('Remaining', `${key.freeRequests.remaining}`),
                    new UsageItem('Scope', 'OpenRouter-reported account counter', undefined, undefined, undefined,
                        'This is the API-reported daily policy. Exempt accounts/endpoints and BYOK may not be gated by it; the per-minute counter is not available.'),
                ], 'symbol-number'));
            } else {
                rows.push(new UsageItem('Free-model requests', 'Counter not reported by API'));
            }
            if (state.keyUpdatedAt) {
                rows.push(new UsageItem('Key last updated', state.keyUpdatedAt.toLocaleTimeString(), undefined, 'clock', undefined, state.keyUpdatedAt.toISOString()));
            }
        } else if (!state.keyConfigured) {
            rows.push(new UsageItem('Set API key for key usage', undefined, undefined, 'key', 'openrouterUsage.setApiKey'));
        }
        if (state.accountError) { rows.push(new UsageItem('Account credits unavailable', state.accountError, undefined, 'warning')); }
        if (state.account) {
            const account = state.account;
            rows.push(new UsageItem('Account credits · USD', state.accountError ? 'Last successful data' : undefined, [
                new UsageItem('Remaining balance', formatUsd(account.totalCredits - account.totalUsage)),
                new UsageItem('Total purchased', formatUsd(account.totalCredits)),
                new UsageItem('Total used', formatUsd(account.totalUsage)),
                new UsageItem('Last updated', state.accountUpdatedAt?.toLocaleTimeString() ?? 'Not reported'),
            ], 'credit-card'));
        } else if (!state.managementConfigured) {
            rows.push(new UsageItem('Add management key for account balance', undefined, undefined, 'credit-card', 'openrouterUsage.setManagementKey'));
        }
        return rows;
    }

    dispose(): void { this.emitter.dispose(); }
}

export function updateStatusBar(bar: vscode.StatusBarItem, state: UsageState): void {
    const config = vscode.workspace.getConfiguration('openrouterUsage');
    bar.backgroundColor = undefined;
    bar.command = 'openrouterUsage.showUsage';
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('**OpenRouter Usage**\n\n');
    if (state.key) {
        const limit = getLimitUsage(state.key);
        bar.text = limit ? `$(dashboard) OR ${formatUsd(limit.remaining)} left` : `$(dashboard) OR ${formatUsd(state.key.usage)} used`;
        tooltip.appendText(`All-time key spending: ${formatUsd(state.key.usage)}\n`);
        if (limit) {
            tooltip.appendText(`Current cap period: ${formatUsd(limit.used)} / ${formatUsd(limit.limit)} (${limit.percent.toFixed(1)}%)\n`);
            if (limit.percent >= config.get<number>('warningThresholdPercent', 80)) {
                bar.backgroundColor = new vscode.ThemeColor(limit.remaining <= 0 ? 'statusBarItem.errorBackground' : 'statusBarItem.warningBackground');
            }
        } else {
            tooltip.appendText(state.key.limit === null ? 'No key spending cap; account balance still applies.\n' : 'Current cap usage is not reported.\n');
        }
        if (state.key.freeRequests) {
            tooltip.appendText(`Free requests today: ${state.key.freeRequests.used} / ${state.key.freeRequests.limit}\n`);
        }
        if (state.keyUpdatedAt) { tooltip.appendText(`Key updated: ${state.keyUpdatedAt.toLocaleTimeString()}\n`); }
    } else if (state.account) {
        bar.text = `$(credit-card) OR ${formatUsd(state.account.totalCredits - state.account.totalUsage)} balance`;
    } else if (state.keyConfigured || state.managementConfigured) {
        bar.text = state.refreshing ? '$(sync~spin) OR loading' : '$(warning) OR unavailable';
    } else {
        bar.text = '$(key) OR Set API Key';
        bar.command = 'openrouterUsage.setApiKey';
        tooltip.appendText('Set an API key to start monitoring. Keys are saved in VS Code SecretStorage.\n');
    }
    if (state.account) { tooltip.appendText(`Account balance: ${formatUsd(state.account.totalCredits - state.account.totalUsage)}\n`); }
    if (state.keyError || state.accountError) {
        if (state.key || state.account) { bar.text = `$(warning) ${bar.text} (stale)`; }
        bar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        tooltip.appendText(`${state.keyError ?? state.accountError}\nLast successful values may be out of date.\n`);
    }
    if (state.refreshing) { tooltip.appendText('Refreshing…\n'); }
    tooltip.appendText('Click to open usage details.');
    bar.tooltip = tooltip;
    bar.accessibilityInformation = { label: bar.text.replace(/\$\([^)]+\)/g, '').trim() };
    if (config.get<boolean>('showStatusBar', true)) { bar.show(); } else { bar.hide(); }
}