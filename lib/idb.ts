/**
 * Minimal promise wrapper over IndexedDB.
 *
 * IndexedDB rather than localStorage because the location queue can hold
 * thousands of points from a long offline trip: localStorage is synchronous,
 * capped around 5MB, string-only, and blocks the main thread — all of which
 * would make it a poor place to write a GPS fix every few seconds.
 *
 * No wrapper library is pulled in for this; the surface actually needed is
 * small and a dependency would be hard to justify.
 *
 * Every helper fails soft. Private browsing, blocked storage, and SSR must not
 * be able to throw inside a geolocation callback, so callers get null/empty
 * results and the queue falls back to memory (see lib/queue.ts).
 */

const DB_NAME = "nofikar";
const DB_VERSION = 1;

export const STORE_LOCATIONS = "pending_locations";
export const STORE_EVENTS = "pending_events";
export const STORE_META = "meta";

export type StoreName =
  | typeof STORE_LOCATIONS
  | typeof STORE_EVENTS
  | typeof STORE_META;

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function idbSupported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase | null> {
  if (!idbSupported()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      console.warn("IndexedDB unavailable:", err);
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_LOCATIONS)) {
        const store = db.createObjectStore(STORE_LOCATIONS, {
          keyPath: "local_id",
        });
        // `synced` is stored as 0/1: IndexedDB cannot index booleans.
        store.createIndex("synced", "synced");
        store.createIndex("recorded_at", "recorded_at");
      }

      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const store = db.createObjectStore(STORE_EVENTS, { keyPath: "local_id" });
        store.createIndex("synced", "synced");
        store.createIndex("recorded_at", "recorded_at");
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Another tab requested a version change; close so it is not blocked.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      console.warn("Failed to open IndexedDB:", request.error);
      resolve(null);
    };

    request.onblocked = () => {
      console.warn("IndexedDB open blocked by another tab");
      resolve(null);
    };
  });

  return dbPromise;
}

function runTransaction<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  work: (objectStore: IDBObjectStore) => IDBRequest<T> | null
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);

        let tx: IDBTransaction;
        try {
          tx = db.transaction(store, mode);
        } catch (err) {
          console.warn(`IndexedDB transaction on ${store} failed:`, err);
          return resolve(null);
        }

        let request: IDBRequest<T> | null = null;
        try {
          request = work(tx.objectStore(store));
        } catch (err) {
          console.warn(`IndexedDB operation on ${store} failed:`, err);
          return resolve(null);
        }

        tx.oncomplete = () => resolve(request ? request.result : null);
        tx.onerror = () => {
          console.warn(`IndexedDB transaction error on ${store}:`, tx.error);
          resolve(null);
        };
        tx.onabort = () => resolve(null);
      })
  );
}

export function idbPut<T>(store: StoreName, value: T): Promise<boolean> {
  return runTransaction(store, "readwrite", (os) => os.put(value)).then(
    () => true,
    () => false
  );
}

/** One transaction for many records: far cheaper than a put per row. */
export async function idbPutMany<T>(store: StoreName, values: T[]): Promise<boolean> {
  if (values.length === 0) return true;
  const db = await openDb();
  if (!db) return false;

  return new Promise((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(store, "readwrite");
    } catch {
      return resolve(false);
    }
    const os = tx.objectStore(store);
    for (const value of values) os.put(value);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export async function idbDeleteMany(
  store: StoreName,
  keys: string[]
): Promise<boolean> {
  if (keys.length === 0) return true;
  const db = await openDb();
  if (!db) return false;

  return new Promise((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(store, "readwrite");
    } catch {
      return resolve(false);
    }
    const os = tx.objectStore(store);
    for (const key of keys) os.delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export async function idbGet<T>(
  store: StoreName,
  key: string
): Promise<T | null> {
  const result = await runTransaction<T>(store, "readonly", (os) =>
    os.get(key) as IDBRequest<T>
  );
  return result ?? null;
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  const result = await runTransaction<T[]>(store, "readonly", (os) =>
    os.getAll() as IDBRequest<T[]>
  );
  return result ?? [];
}

/** Reads by index value, e.g. every record where synced = 0. */
export async function idbGetByIndex<T>(
  store: StoreName,
  index: string,
  value: IDBValidKey,
  limit?: number
): Promise<T[]> {
  const db = await openDb();
  if (!db) return [];

  return new Promise((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(store, "readonly");
    } catch {
      return resolve([]);
    }

    const out: T[] = [];
    const request = tx.objectStore(store).index(index).openCursor(IDBKeyRange.only(value));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      out.push(cursor.value as T);
      if (limit != null && out.length >= limit) return;
      cursor.continue();
    };

    tx.oncomplete = () => resolve(out);
    tx.onerror = () => resolve(out);
    tx.onabort = () => resolve(out);
  });
}

export async function idbCountByIndex(
  store: StoreName,
  index: string,
  value: IDBValidKey
): Promise<number> {
  const result = await runTransaction<number>(store, "readonly", (os) =>
    os.index(index).count(IDBKeyRange.only(value))
  );
  return result ?? 0;
}
