/**
 * Stores the GitHub PAT encrypted-at-rest via Electron safeStorage (DPAPI on
 * Windows — the file only decrypts for the same OS user on the same machine).
 * Unlike the other core services this one imports Electron by necessity;
 * where OS-level encryption is unavailable (some Linux setups) it falls back
 * to base64 so the app still works, which is obfuscation, not security.
 */
import { safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';

export class TokenStore {
  private cached: string | null | undefined;

  constructor(private readonly file: string) {}

  get(): string | null {
    if (this.cached !== undefined) return this.cached;
    if (!existsSync(this.file)) return (this.cached = null);
    try {
      const raw = readFileSync(this.file);
      this.cached = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(raw)
        : Buffer.from(raw.toString('utf8'), 'base64').toString('utf8');
    } catch {
      this.cached = null;
    }
    return this.cached;
  }

  set(token: string): void {
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(token)
      : Buffer.from(Buffer.from(token, 'utf8').toString('base64'), 'utf8');
    writeFileSync(this.file, data);
    this.cached = token;
  }

  clear(): void {
    if (existsSync(this.file)) rmSync(this.file);
    this.cached = null;
  }
}
