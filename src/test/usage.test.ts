import * as assert from 'node:assert/strict';
import { KeyUsage } from '../api';
import { formatOptionalUsd, formatUsd, getLimitUsage } from '../usage';

function key(values: Partial<KeyUsage> = {}): KeyUsage {
    return { label: 'test', usage: 100, limit: 10, limitRemaining: 7, limitReset: null, includeByokInLimit: false, ...values };
}

suite('Usage calculations', () => {
    test('Uses authoritative remaining credits rather than all-time spending', () => {
        assert.deepEqual(getLimitUsage(key({ limitReset: 'monthly', usageMonthly: 3 })), { limit: 10, used: 3, remaining: 7, percent: 30 });
    });
    test('Does not invent a remaining balance for uncapped keys', () => {
        assert.equal(getLimitUsage(key({ limit: null })), undefined);
    });
    test('Falls back to current reset-period usage', () => {
        for (const limitReset of ['daily', 'weekly', 'monthly']) {
            assert.equal(getLimitUsage(key({ limitRemaining: undefined, limitReset, usageDaily: 2, usageWeekly: 2, usageMonthly: 2 }))?.used, 2);
        }
    });
    test('Includes BYOK only when requested by the key limit', () => {
        assert.equal(getLimitUsage(key({
            limitRemaining: undefined, limitReset: 'monthly', usageMonthly: 2,
            includeByokInLimit: true, byokUsageMonthly: 3
        }))?.remaining, 5);
    });
    test('Does not guess when reset period or required BYOK usage is missing', () => {
        assert.equal(getLimitUsage(key({ limitRemaining: undefined, limitReset: 'unknown' })), undefined);
        assert.equal(getLimitUsage(key({ limitRemaining: undefined, limitReset: undefined })), undefined);
        assert.equal(getLimitUsage(key({ limitRemaining: undefined, includeByokInLimit: true })), undefined);
    });
    test('Never-reset fallback uses all-time spending', () => {
        assert.equal(getLimitUsage(key({ limitRemaining: undefined, usage: 2 }))?.remaining, 8);
    });
    test('Zero spending caps count as exhausted without division by zero', () => {
        assert.equal(getLimitUsage(key({ limit: 0, limitRemaining: 0 }))?.percent, 100);
    });
    test('Keeps overspending visible', () => {
        assert.deepEqual(getLimitUsage(key({ limitRemaining: -2 })), { limit: 10, used: 12, remaining: -2, percent: 120 });
    });
    test('Formats sub-cent spending and treats absent usage differently from zero', () => {
        assert.equal(formatUsd(0.0012), '$0.0012');
        assert.equal(formatOptionalUsd(0), '$0.00');
        assert.equal(formatOptionalUsd(undefined), 'Not reported');
    });
});