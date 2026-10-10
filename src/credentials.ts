import { OpenRouterClient, OpenRouterError } from './api';

/** Separates credential validation from secure-storage failure without exposing raw exceptions. */
export async function validateAndSaveKey(client: OpenRouterClient,
    secrets: { store(name: string, value: string): PromiseLike<void> },
    name: string, input: string, management: boolean): Promise<void> {
    const key = input.trim();
    if (management) { await client.getAccountCredits(key); } else { await client.getKeyUsage(key); }
    try {
        await secrets.store(name, key);
    } catch {
        throw new OpenRouterError('Your key is valid, but VS Code secure storage could not save it. Run Developer: Reload Window and set the key again.');
    }
}