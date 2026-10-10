import * as assert from 'node:assert/strict';
import { OpenRouterClient, OpenRouterError, parseAccountCredits, parseKeyUsage, retryAfterMilliseconds } from '../api';
import { validateAndSaveKey } from '../credentials';

suite('OpenRouter API', () => {
    test('Parses usage, BYOK values, and free request counters', () => {
        const key = parseKeyUsage({
            data: {
                label: 'test', usage: 12, limit: 20, limit_remaining: 8, limit_reset: 'monthly',
                usage_daily: 1, usage_weekly: 4, usage_monthly: 12, include_byok_in_limit: true,
                byok_usage: 3, is_free_tier: false, free_model_daily_requests: { used: 9, limit: 50, remaining: 41 },
            }
        });
        assert.equal(key.limitRemaining, 8);
        assert.equal(key.usageDaily, 1);
        assert.equal(key.includeByokInLimit, true);
        assert.deepEqual(key.freeRequests, { used: 9, limit: 50, remaining: 41 });
    });

    test('Handles older responses with optional fields absent', () => {
        const key = parseKeyUsage({ data: { usage: 0, limit: null } });
        assert.equal(key.limit, null);
        assert.equal(key.usageDaily, undefined);
        assert.equal(key.freeRequests, undefined);
    });

    test('Rejects malformed responses and non-finite or negative limits', () => {
        for (const payload of [null, {}, { data: [] }, { data: { usage: '2', limit: null } },
            { data: { usage: 2, limit: -1 } }, { data: { usage: NaN, limit: null } },
            { data: { usage: 2, limit: Infinity } }]) {
            assert.throws(() => parseKeyUsage(payload), OpenRouterError);
        }
    });

    test('Parses account credits independently from key usage', () => {
        assert.deepEqual(parseAccountCredits({ data: { total_credits: 50, total_usage: 12 } }), { totalCredits: 50, totalUsage: 12 });
        assert.throws(() => parseAccountCredits({ data: { total_credits: '50' } }), OpenRouterError);
    });

    test('Parses both Retry-After formats', () => {
        assert.equal(retryAfterMilliseconds('30'), 30_000);
        assert.equal(retryAfterMilliseconds('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60_000);
        assert.equal(retryAfterMilliseconds(null), undefined);
        assert.equal(retryAfterMilliseconds('not a date'), undefined);
    });

    test('Uses a fixed HTTPS endpoint, bearer auth, timeout, and disallows redirects', async () => {
        const client = new OpenRouterClient(async (url, options) => {
            assert.equal(url, 'https://openrouter.ai/api/v1/key');
            assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-only-key');
            assert.equal(options?.method, 'GET');
            assert.equal(options?.redirect, 'error');
            assert.equal(options?.cache, 'no-store');
            assert.ok(options?.signal);
            return Response.json({ data: { usage: 1, limit: null } });
        });
        assert.equal((await client.getKeyUsage('test-only-key')).usage, 1);
    });

    test('Explains management-key permissions without exposing response bodies', async () => {
        const client = new OpenRouterClient(async () => new Response('secret response body', { status: 403 }));
        await assert.rejects(client.getAccountCredits('test-only-key'), (error: unknown) => {
            assert.ok(error instanceof OpenRouterError);
            assert.equal(error.status, 403);
            assert.match(error.message, /management key/);
            assert.doesNotMatch(error.message, /secret response body/);
            return true;
        });
    });

    test('Propagates rate-limit cooldown', async () => {
        const client = new OpenRouterClient(async () => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }));
        await assert.rejects(client.getKeyUsage('test-only-key'), (error: unknown) => {
            assert.ok(error instanceof OpenRouterError);
            assert.equal(error.retryAfterMs, 120_000);
            return true;
        });
    });

    test('Sanitizes network errors instead of revealing credentials', async () => {
        const client = new OpenRouterClient(async () => { throw new Error('Bearer test-only-key'); });
        await assert.rejects(client.getKeyUsage('test-only-key'), (error: unknown) => {
            assert.ok(error instanceof OpenRouterError);
            assert.match(error.message, /Cannot reach/);
            assert.doesNotMatch(error.message, /test-only-key/);
            return true;
        });
    });

    test('Rejects invalid JSON', async () => {
        const client = new OpenRouterClient(async () => new Response('not JSON'));
        await assert.rejects(client.getKeyUsage('test-only-key'), /invalid JSON/);
    });

    test('Recognizes cancelled requests', async () => {
        const controller = new AbortController();
        controller.abort();
        const client = new OpenRouterClient(async () => { throw new Error('aborted'); });
        await assert.rejects(client.getKeyUsage('test-only-key', controller.signal), /cancelled/);
    });

    test('Rejects hidden or control characters before making requests', async () => {
        let calls = 0;
        const client = new OpenRouterClient(async () => { calls++; return Response.json({}); });
        for (const key of ['test\u200bonly', 'test\u0000only', 'test\u007fonly', 'test only']) {
            await assert.rejects(client.getKeyUsage(key), /hidden characters/);
        }
        assert.equal(calls, 0);
    });

    test('Classifies timeout after response headers without calling it invalid JSON', async () => {
        const timeout = new AbortController();
        const response = Response.json({});
        Object.defineProperty(response, 'json', { value: async () => { timeout.abort(); throw new DOMException('test-only-key', 'AbortError'); } });
        const client = new OpenRouterClient(async () => response, () => timeout.signal);
        await assert.rejects(client.getKeyUsage('test-only-key'), (error: unknown) => {
            assert.ok(error instanceof OpenRouterError);
            assert.match(error.message, /timed out/);
            assert.doesNotMatch(error.message, /invalid JSON|test-only-key/);
            return true;
        });
    });

    test('Classifies cancellation while reading a response body', async () => {
        const controller = new AbortController();
        const response = Response.json({});
        Object.defineProperty(response, 'json', { value: async () => { controller.abort(); throw new DOMException('test-only-key', 'AbortError'); } });
        const client = new OpenRouterClient(async () => response);
        await assert.rejects(client.getKeyUsage('test-only-key', controller.signal), /cancelled/);
    });

    test('Classifies interrupted response bodies as connection failures', async () => {
        const response = Response.json({});
        Object.defineProperty(response, 'json', { value: async () => { throw new TypeError('Bearer test-only-key'); } });
        const client = new OpenRouterClient(async () => response);
        await assert.rejects(client.getKeyUsage('test-only-key'), (error: unknown) => {
            assert.ok(error instanceof OpenRouterError);
            assert.match(error.message, /receive its response/);
            assert.doesNotMatch(error.message, /invalid JSON|test-only-key/);
            return true;
        });
    });

    test('Reports allowlisted DNS and TLS causes without raw error details', async () => {
        for (const [code, expected] of [['ENOTFOUND', /DNS/], ['SELF_SIGNED_CERT_IN_CHAIN', /certificates/]] as const) {
            const client = new OpenRouterClient(async () => { throw new TypeError('test-only-key', { cause: { code, secret: 'test-only-key' } }); });
            await assert.rejects(client.getKeyUsage('test-only-key'), (error: unknown) => {
                assert.ok(error instanceof OpenRouterError);
                assert.match(error.message, expected);
                assert.doesNotMatch(error.message, /test-only-key/);
                return true;
            });
        }
    });

    test('Trims surrounding whitespace before sending authorization', async () => {
        const client = new OpenRouterClient(async (_url, options) => {
            assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-only-key');
            return Response.json({ data: { usage: 0, limit: null } });
        });
        await client.getKeyUsage('  test-only-key\r\n');
    });

    test('Explains secure-storage write failure separately from valid credentials', async () => {
        const client = new OpenRouterClient(async () => Response.json({ data: { usage: 0, limit: null } }));
        const secrets = { store: async () => { throw new Error('Bearer test-only-key'); } };
        await assert.rejects(validateAndSaveKey(client, secrets, 'test-name', 'test-only-key', false), (error: unknown) => {
            assert.ok(error instanceof OpenRouterError);
            assert.match(error.message, /key is valid.*secure storage could not save/);
            assert.doesNotMatch(error.message, /test-only-key/);
            return true;
        });
    });

    test('Does not replace saved credentials when validation fails', async () => {
        let calls = 0;
        const client = new OpenRouterClient(async () => new Response(null, { status: 401 }));
        const secrets = { store: async () => { calls++; } };
        await assert.rejects(validateAndSaveKey(client, secrets, 'test-name', 'test-only-key', false), /invalid or expired/);
        assert.equal(calls, 0);
    });

    test('Validates optional management key on the credits endpoint before storing it', async () => {
        let saved = false;
        const client = new OpenRouterClient(async url => {
            assert.equal(url, 'https://openrouter.ai/api/v1/credits');
            return Response.json({ data: { total_credits: 10, total_usage: 1 } });
        });
        const secrets = {
            store: async (name: string, value: string) => {
                assert.equal(name, 'test-name'); assert.equal(value, 'test-only-key'); saved = true;
            }
        };
        await validateAndSaveKey(client, secrets, 'test-name', '  test-only-key  ', true);
        assert.equal(saved, true);
    });
});