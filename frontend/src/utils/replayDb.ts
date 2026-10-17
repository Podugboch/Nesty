/**
 * IndexedDB helper for resilient chunked live replay recording.
 * Chunks are saved locally every 5s so unexpected browser closing, app suspension,
 * or network failures do not result in lost recordings.
 */

const DB_NAME = "nesty_live_replays_db";
const STORE_NAME = "replay_chunks";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not supported on this platform"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("live_id", "live_id", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveChunkLocally(liveId: number, chunkIndex: number, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const id = `${liveId}_${chunkIndex}`;
    store.put({
      id,
      live_id: liveId,
      chunk_index: chunkIndex,
      blob,
      timestamp: Date.now(),
    });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("[ReplayDB] Failed to save chunk locally:", err);
  }
}

export async function getStoredChunksForLive(liveId: number): Promise<{ chunk_index: number; blob: Blob }[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("live_id");
    const request = index.getAll(IDBKeyRange.only(liveId));

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const items = request.result || [];
        items.sort((a, b) => a.chunk_index - b.chunk_index);
        resolve(items.map((it) => ({ chunk_index: it.chunk_index, blob: it.blob })));
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("[ReplayDB] Failed to get chunks for live:", err);
    return [];
  }
}

export async function assembleLocalReplayBlob(liveId: number): Promise<Blob | null> {
  const chunks = await getStoredChunksForLive(liveId);
  if (chunks.length === 0) return null;
  const blobs = chunks.map((c) => c.blob);
  const mimeType = blobs[0]?.type || "video/webm";
  return new Blob(blobs, { type: mimeType });
}

export async function findUnfinishedReplays(): Promise<number[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const items = request.result || [];
        const liveIds = Array.from(new Set(items.map((it) => it.live_id)));
        resolve(liveIds);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("[ReplayDB] Failed to find unfinished replays:", err);
    return [];
  }
}

export async function clearLocalReplay(liveId: number): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("live_id");
    const request = index.getAllKeys(IDBKeyRange.only(liveId));

    request.onsuccess = () => {
      const keys = request.result || [];
      keys.forEach((key) => store.delete(key));
    };

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("[ReplayDB] Failed to clear local replay:", err);
  }
}
