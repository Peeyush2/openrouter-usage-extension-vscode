import * as vscode from 'vscode';
import { AccountCredits, KeyUsage, OpenRouterClient, OpenRouterError } from './api';

export const apiKeySecret = 'openrouterUsage.apiKey';
export const managementKeySecret = 'openrouterUsage.managementKey';

export interface UsageState {
    keyConfigured: boolean;
    managementConfigured: boolean;
    key?: KeyUsage;
    account?: AccountCredits;
    keyUpdatedAt?: Date;
    accountUpdatedAt?: Date;
    keyError?: string;
    accountError?: string;
    refreshing: boolean;
}

type Endpoint = 'key' | 'account';

export function safeError(error: unknown): string {
    return error instanceof OpenRouterError ? error.message : 'Unable to access saved usage. Please try again.';
}

export class UsageMonitor implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<UsageState>();
    readonly onDidChange = this.emitter.event;
    state: UsageState = { keyConfigured: false, managementConfigured: false, refreshing: false };
    private timer?: ReturnType<typeof setInterval>;
    private controller?: AbortController;
    private inFlight?: Promise<void>;
    private generation = 0;
    private disposed = false;
    private nextAllowed: Record<Endpoint, number> = { key: 0, account: 0 };
    private failures: Record<Endpoint, number> = { key: 0, account: 0 };
    private blocked: Record<Endpoint, boolean> = { key: false, account: false };
    private storageFailed: Record<Endpoint, boolean> = { key: false, account: false };

    constructor(private readonly secrets: vscode.SecretStorage, private readonly client = new OpenRouterClient()) { }

    async start(): Promise<void> {
        this.configureTimer();
        await this.refresh();
    }

    configureTimer(): void {
        if (this.timer) {
            clearInterval(this.timer);
        }
        const config = vscode.workspace.getConfiguration('openrouterUsage');
        if (config.get<boolean>('autoRefresh', true) && !this.disposed) {
            const configured = config.get<number>('refreshIntervalSeconds', 60);
            const seconds = Number.isFinite(configured) ? Math.max(15, Math.min(3600, configured)) : 60;
            this.timer = setInterval(() => { void this.refresh(); }, seconds * 1000);
        }
        this.emitter.fire(this.state);
    }

    async secretsChanged(): Promise<void> {
        this.generation++;
        this.controller?.abort();
        this.inFlight = undefined;
        this.nextAllowed = { key: 0, account: 0 };
        this.failures = { key: 0, account: 0 };
        this.blocked = { key: false, account: false };
        this.storageFailed = { key: false, account: false };
        this.state = { keyConfigured: false, managementConfigured: false, refreshing: false };
        this.emitter.fire(this.state);
        await this.refresh();
    }

    refresh(manual = false): Promise<void> {
        if (this.disposed) {
            return Promise.resolve();
        }
        if (this.inFlight) {
            return this.inFlight;
        }
        if (manual) {
            this.blocked = { key: false, account: false };
        }
        const generation = this.generation;
        const controller = new AbortController();
        this.controller = controller;
        this.state.refreshing = true;
        this.emitter.fire(this.state);
        const work = this.fetchUsage(generation, controller.signal).finally(() => {
            if (!this.disposed && generation === this.generation) {
                this.state.refreshing = false;
                this.inFlight = undefined;
                this.emitter.fire(this.state);
            }
        });
        this.inFlight = work;
        return work;
    }

    refreshErrorMessage(): string {
        const errors: string[] = [];
        for (const endpoint of ['key', 'account'] as const) {
            const error = endpoint === 'key' ? this.state.keyError : this.state.accountError;
            if (!error) { continue; }
            const seconds = Math.ceil((this.nextAllowed[endpoint] - Date.now()) / 1000);
            errors.push(`${endpoint === 'key' ? 'Key usage' : 'Account credits'}: ${error}${seconds > 0 ? ` Retry available in ${seconds} seconds.` : ''}`);
        }
        return errors.join(' ');
    }

    private async fetchUsage(generation: number, signal: AbortSignal): Promise<void> {
        await Promise.all([
            this.readAndFetch('key', apiKeySecret, generation, signal),
            this.readAndFetch('account', managementKeySecret, generation, signal),
        ]);
    }

    private async readAndFetch(endpoint: Endpoint, name: string, generation: number, signal: AbortSignal): Promise<void> {
        let key: string | undefined;
        try {
            key = await this.secrets.get(name);
        } catch {
            if (this.disposed || generation !== this.generation) { return; }
            this.storageFailed[endpoint] = true;
            const message = `Cannot read the ${endpoint === 'key' ? 'API' : 'management'} key from VS Code secure storage. Run Developer: Reload Window and try again.`;
            if (endpoint === 'key') { this.state.keyError = message; } else { this.state.accountError = message; }
            return;
        }
        if (this.disposed || generation !== this.generation) { return; }
        if (this.storageFailed[endpoint] || !key) {
            if (endpoint === 'key') { this.state.keyError = undefined; } else { this.state.accountError = undefined; }
            this.storageFailed[endpoint] = false;
            this.nextAllowed[endpoint] = 0;
            this.blocked[endpoint] = false;
        }
        if (endpoint === 'key') {
            this.state.keyConfigured = !!key;
            if (!key) { this.state.key = undefined; this.state.keyUpdatedAt = undefined; }
        } else {
            this.state.managementConfigured = !!key;
            if (!key) { this.state.account = undefined; this.state.accountUpdatedAt = undefined; }
        }
        await this.fetchEndpoint(endpoint, key, generation, signal);
    }

    private async fetchEndpoint(endpoint: Endpoint, key: string | undefined, generation: number, signal: AbortSignal): Promise<void> {
        if (!key || this.blocked[endpoint] || Date.now() < this.nextAllowed[endpoint]) {
            return;
        }
        try {
            if (endpoint === 'key') {
                const usage = await this.client.getKeyUsage(key, signal);
                if (this.disposed || generation !== this.generation) { return; }
                this.state.key = usage;
                this.state.keyUpdatedAt = new Date();
                this.state.keyError = undefined;
            } else {
                const credits = await this.client.getAccountCredits(key, signal);
                if (this.disposed || generation !== this.generation) { return; }
                this.state.account = credits;
                this.state.accountUpdatedAt = new Date();
                this.state.accountError = undefined;
            }
            this.failures[endpoint] = 0;
            this.nextAllowed[endpoint] = 0;
        } catch (error) {
            if (this.disposed || generation !== this.generation) { return; }
            if (endpoint === 'key') {
                this.state.keyError = safeError(error);
            } else {
                this.state.accountError = safeError(error);
            }
            this.failures[endpoint]++;
            const backoff = Math.min(300_000, 5_000 * 2 ** Math.min(6, this.failures[endpoint] - 1));
            const retry = error instanceof OpenRouterError ? error.retryAfterMs ?? 0 : 0;
            this.nextAllowed[endpoint] = Date.now() + Math.max(backoff, retry,
                error instanceof OpenRouterError && error.status === 429 ? 60_000 : 0);
            this.blocked[endpoint] = error instanceof OpenRouterError && (error.status === 401 || error.status === 403);
        }
    }

    dispose(): void {
        this.disposed = true;
        this.generation++;
        if (this.timer) { clearInterval(this.timer); }
        this.controller?.abort();
        this.emitter.dispose();
    }
}