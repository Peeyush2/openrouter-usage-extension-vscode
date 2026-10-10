export interface KeyUsage {
    label: string;
    limit: number | null;
    limitRemaining?: number | null;
    limitReset?: string | null;
    includeByokInLimit: boolean;
    usage: number;
    usageDaily?: number;
    usageWeekly?: number;
    usageMonthly?: number;
    byokUsage?: number;
    byokUsageDaily?: number;
    byokUsageWeekly?: number;
    byokUsageMonthly?: number;
    isFreeTier?: boolean;
    freeRequests?: { used: number; limit: number; remaining: number };
}

export interface AccountCredits {
    totalCredits: number;
    totalUsage: number;
}

export class OpenRouterError extends Error {
    constructor(message: string, readonly status?: number, readonly retryAfterMs?: number) {
        super(message);
        this.name = 'OpenRouterError';
    }
}

export function validateApiKey(key: string): string | undefined {
    const trimmed = key.trim();
    if (!trimmed) { return 'Enter an OpenRouter key.'; }
    if (/[^\x21-\x7e]/.test(trimmed)) {
        return 'The key contains spaces, hidden characters, or non-ASCII characters. Copy just the key from OpenRouter.';
    }
    return undefined;
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new OpenRouterError('OpenRouter returned an unexpected response.');
    }
    return value as Record<string, unknown>;
}

function number(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new OpenRouterError('OpenRouter returned an invalid numeric value.');
    }
    return value;
}

function optionalNumber(value: unknown): number | undefined {
    return value === undefined || value === null ? undefined : number(value);
}

export function parseKeyUsage(payload: unknown): KeyUsage {
    const data = object(object(payload).data);
    if (data.limit !== null && (typeof data.limit !== 'number' || data.limit < 0)) {
        throw new OpenRouterError('OpenRouter returned an invalid key limit.');
    }
    const result: KeyUsage = {
        label: typeof data.label === 'string' ? data.label : 'API key',
        limit: data.limit === null ? null : number(data.limit),
        limitRemaining: data.limit_remaining === null ? null : optionalNumber(data.limit_remaining),
        limitReset: typeof data.limit_reset === 'string' ? data.limit_reset : data.limit_reset === null ? null : undefined,
        includeByokInLimit: data.include_byok_in_limit === true,
        usage: number(data.usage),
        usageDaily: optionalNumber(data.usage_daily),
        usageWeekly: optionalNumber(data.usage_weekly),
        usageMonthly: optionalNumber(data.usage_monthly),
        byokUsage: optionalNumber(data.byok_usage),
        byokUsageDaily: optionalNumber(data.byok_usage_daily),
        byokUsageWeekly: optionalNumber(data.byok_usage_weekly),
        byokUsageMonthly: optionalNumber(data.byok_usage_monthly),
        isFreeTier: typeof data.is_free_tier === 'boolean' ? data.is_free_tier : undefined,
    };
    if (data.free_model_daily_requests !== undefined && data.free_model_daily_requests !== null) {
        const free = object(data.free_model_daily_requests);
        result.freeRequests = { used: number(free.used), limit: number(free.limit), remaining: number(free.remaining) };
    }
    return result;
}

export function parseAccountCredits(payload: unknown): AccountCredits {
    const data = object(object(payload).data);
    return { totalCredits: number(data.total_credits), totalUsage: number(data.total_usage) };
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number | undefined {
    if (!value) {
        return undefined;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000;
    }
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** Only fixed OpenRouter HTTPS endpoints are allowed; redirects cannot receive credentials. */
export class OpenRouterClient {
    constructor(private readonly fetcher: typeof fetch = fetch,
        private readonly createTimeout: () => AbortSignal = () => AbortSignal.timeout(15_000)) { }

    async getKeyUsage(key: string, signal?: AbortSignal): Promise<KeyUsage> {
        return parseKeyUsage(await this.request('key', key, signal));
    }

    async getAccountCredits(key: string, signal?: AbortSignal): Promise<AccountCredits> {
        return parseAccountCredits(await this.request('credits', key, signal));
    }

    private async request(endpoint: 'key' | 'credits', key: string, signal?: AbortSignal): Promise<unknown> {
        const inputError = validateApiKey(key);
        if (inputError) { throw new OpenRouterError(inputError); }
        const timeout = this.createTimeout();
        try {
            const response = await this.fetcher(`https://openrouter.ai/api/v1/${endpoint}`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${key.trim()}`, Accept: 'application/json' },
                redirect: 'error',
                cache: 'no-store',
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            });
            if (!response.ok) {
                const messages: Record<number, string> = {
                    401: 'The API key is invalid or expired. Set a new key.',
                    402: 'OpenRouter reports insufficient credits or an exhausted spending limit.',
                    403: endpoint === 'credits' ? 'Account credits require an OpenRouter management key.' : 'This key cannot access usage information.',
                    429: 'OpenRouter is rate limiting requests. Refresh will resume after a cooldown.',
                };
                throw new OpenRouterError(messages[response.status] ?? `OpenRouter request failed (HTTP ${response.status}).`,
                    response.status, retryAfterMilliseconds(response.headers.get('retry-after')));
            }
            try {
                return await response.json();
            } catch (error) {
                if (!signal?.aborted && !timeout.aborted && error instanceof SyntaxError) {
                    throw new OpenRouterError('OpenRouter returned invalid JSON. Refresh Usage after a few seconds; if it persists, check whether your proxy is replacing the response.');
                }
                throw error;
            }
        } catch (error) {
            if (error instanceof OpenRouterError) {
                throw error;
            }
            if (signal?.aborted) {
                throw new OpenRouterError('Request cancelled.');
            }
            if (timeout.aborted) {
                throw new OpenRouterError('OpenRouter timed out after 15 seconds. Check your connection and run Refresh Usage.');
            }
            const cause = error instanceof Error ? error.cause : undefined;
            const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
            if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
                throw new OpenRouterError('Cannot resolve openrouter.ai. Check your DNS, VPN, and internet connection.');
            }
            if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
                throw new OpenRouterError('Cannot verify OpenRouter HTTPS certificates. Check your system clock and trusted proxy certificates; do not disable certificate verification.');
            }
            throw new OpenRouterError('Cannot reach OpenRouter or receive its response. Check your connection, VPN, and VS Code proxy settings.');
        }
    }
}