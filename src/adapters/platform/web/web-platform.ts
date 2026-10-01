import type { Platform } from '../../../core/interfaces/platform.ts';

const DB_NAME = 'waterplay';
const STORE = 'kv';

/** Browser Platform: IndexedDB storage, no achievements or overlays. */
export class WebPlatform implements Platform {
  readonly kind = 'web' as const;
  private db: Promise<IDBDatabase> | undefined;

  getPlayerName(): string {
    try {
      return localStorage.getItem('waterplay.playerName') ?? 'Sailor';
    } catch {
      return 'Sailor';
    }
  }

  unlockAchievement(_id: string): void {}

  async saveData(key: string, data: Uint8Array): Promise<void> {
    const db = await this.open();
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(data, key));
  }

  async loadData(key: string): Promise<Uint8Array | null> {
    const db = await this.open();
    const value = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
    return value instanceof Uint8Array ? value : null;
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
