import { KeyUsage } from './api';

export interface LimitUsage {
    limit: number;
    used: number;
    remaining: number;
    percent: number;
}

/** limit_remaining is authoritative, especially for daily/weekly/monthly resetting limits. */
export function getLimitUsage(key: KeyUsage): LimitUsage | undefined {
    if (key.limit === null) {
        return undefined;
    }
    let remaining = key.limitRemaining;
    if (typeof remaining !== 'number') {
        let used: number | undefined;
        let byok: number | undefined;
        switch (key.limitReset) {
            case 'daily': used = key.usageDaily; byok = key.byokUsageDaily; break;
            case 'weekly': used = key.usageWeekly; byok = key.byokUsageWeekly; break;
            case 'monthly': used = key.usageMonthly; byok = key.byokUsageMonthly; break;
            case null: used = key.usage; byok = key.byokUsage; break;
            default: return undefined;
        }
        if (used === undefined || (key.includeByokInLimit && byok === undefined)) {
            return undefined;
        }
        remaining = key.limit - used - (key.includeByokInLimit ? byok ?? 0 : 0);
    }
    const used = Math.max(0, key.limit - remaining);
    return { limit: key.limit, used, remaining, percent: key.limit === 0 ? 100 : used / key.limit * 100 };
}

export function formatUsd(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
    }).format(amount);
}

export function formatOptionalUsd(amount?: number): string {
    return amount === undefined ? 'Not reported' : formatUsd(amount);
}