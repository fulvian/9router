import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";
import os from "os";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const isCloud = typeof process === 'undefined' || process.env.NEXT_RUNTIME === 'edge';

function getDataDir() {
  if (isCloud) return "/tmp";
  return process.env.DATA_DIR || path.join(os.homedir(), ".9router");
}

const DATA_DIR = getDataDir();
const DLQ_FILE = isCloud ? null : path.join(DATA_DIR, "dlq.json");

if (!isCloud && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultData = { entries: [] };
let dbInstance = null;

// ============================================================================
// WRITE MUTEX - Serializes all write operations to prevent race conditions
// ============================================================================
class WriteMutex {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  async runExclusive(fn) {
    return new Promise((resolve, reject) => {
      const task = { fn, resolve, reject };
      this.queue.push(task);
      
      if (!this.isProcessing) {
        this.isProcessing = true;
        this.processQueue();
      }
    });
  }

  async processQueue() {
    while (this.queue.length > 0) {
      const { fn, resolve, reject } = this.queue.shift();
      
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        this.isProcessing = false;
        // Process next item in queue
        if (this.queue.length > 0) {
          this.isProcessing = true;
          this.processQueue();
        }
      }
    }
  }
}

// Global write mutex instance
const writeMutex = new WriteMutex();

// ============================================================================
// RETRY LOGIC - Exponential backoff for transient errors
// ============================================================================
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 50) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Only retry on ENOENT (file not found) or rename errors (race condition)
      const isRetryable = 
        error.code === 'ENOENT' ||
        error.code === 'EACCES' ||
        error.code === 'EBUSY' ||
        error.message?.includes('rename') ||
        error.message?.includes('ENOENT');
      
      if (isRetryable && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 25;
        console.warn(`[DLQ] Write failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw error;
      }
    }
  }
  
  throw lastError;
}

// ============================================================================
// SAFE WRITE - Serializes all writes through mutex with retry
// ============================================================================
async function safeWrite(db) {
  return writeMutex.runExclusive(async () => {
    return retryWithBackoff(async () => {
      await db.write();
    });
  });
}

async function getDlqDb() {
  if (isCloud) {
    if (!dbInstance) {
      dbInstance = new Low({ read: async () => {}, write: async () => {} }, defaultData);
      dbInstance.data = defaultData;
    }
    return dbInstance;
  }

  if (!dbInstance) {
    dbInstance = new Low(new JSONFile(DLQ_FILE), defaultData);
    try {
      await dbInstance.read();
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn("[DLQ] Corrupt JSON detected, resetting...");
        dbInstance.data = defaultData;
        await safeWrite(dbInstance);
      } else {
        throw error;
      }
    }
  }
  return dbInstance;
}

export async function addToDlq({ model, provider, request, error, connectionId, comboName, comboIndex }) {
  const db = await getDlqDb();

  const entry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    model,
    provider,
    connectionId,
    comboName,
    comboIndex,
    request: {
      model: request?.model,
      messages: request?.messages?.slice(0, 2).map(m => ({
        role: m.role,
        content: typeof m.content === "string" 
          ? m.content.slice(0, 200) 
          : "[truncated]"
      })),
      stream: request?.stream
    },
    error: {
      message: error?.message || "Unknown error",
      status: error?.status || error?.statusCode,
      name: error?.name,
      stack: error?.stack?.slice(0, 500)
    },
    failureCount: 1,
    status: "pending",
    nextRetryAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  };

  db.data.entries.push(entry);
  await safeWrite(db);
  console.log(`[DLQ] Added entry ${entry.id} for provider=${provider} model=${model}`);
  
  return entry;
}

export async function getDlqEntries(filter = {}) {
  const db = await getDlqDb();
  let entries = [...db.data.entries];

  if (filter.status) {
    entries = entries.filter(e => e.status === filter.status);
  }
  if (filter.provider) {
    entries = entries.filter(e => e.provider === filter.provider);
  }
  if (filter.model) {
    entries = entries.filter(e => e.model === filter.model);
  }
  if (filter.comboName) {
    entries = entries.filter(e => e.comboName === filter.comboName);
  }
  if (filter.since) {
    const since = new Date(filter.since).getTime();
    entries = entries.filter(e => new Date(e.timestamp).getTime() >= since);
  }

  return entries.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export async function getDlqEntryById(id) {
  const db = await getDlqDb();
  return db.data.entries.find(e => e.id === id) || null;
}

export async function updateDlqEntry(id, updates) {
  const db = await getDlqDb();
  const index = db.data.entries.findIndex(e => e.id === id);

  if (index === -1) return null;

  db.data.entries[index] = {
    ...db.data.entries[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  await safeWrite(db);
  return db.data.entries[index];
}

export async function incrementDlqFailure(id, error) {
  const db = await getDlqDb();
  const entry = db.data.entries.find(e => e.id === id);
  
  if (!entry) return null;

  entry.failureCount++;
  entry.error = {
    message: error?.message || "Unknown error",
    status: error?.status || error?.statusCode,
    name: error?.name,
    timestamp: new Date().toISOString()
  };
  
  if (entry.failureCount >= 5) {
    entry.status = "exhausted";
  } else {
    entry.nextRetryAt = new Date(
      Date.now() + Math.min(5 * 60 * 1000 * Math.pow(2, entry.failureCount), 3600000)
    ).toISOString();
  }

  await safeWrite(db);
  return entry;
}

export async function retryDlqEntry(id) {
  const db = await getDlqDb();
  const entry = db.data.entries.find(e => e.id === id);
  
  if (!entry) return { success: false, error: "Entry not found" };
  if (entry.status === "retrying") {
    return { success: false, error: "Entry already retrying" };
  }

  entry.status = "retrying";
  entry.lastRetryAt = new Date().toISOString();
  await safeWrite(db);
  return { success: true, entry };
}

export async function archiveDlqEntry(id, reason) {
  return updateDlqEntry(id, {
    status: "archived",
    archivedAt: new Date().toISOString(),
    archiveReason: reason
  });
}

export async function deleteDlqEntry(id) {
  const db = await getDlqDb();
  const index = db.data.entries.findIndex(e => e.id === id);

  if (index === -1) return false;

  db.data.entries.splice(index, 1);
  await safeWrite(db);
  return true;
}

export async function clearDlq(filter = {}) {
  const db = await getDlqDb();
  
  if (!filter.status && !filter.provider) {
    db.data.entries = [];
  } else {
    db.data.entries = db.data.entries.filter(e => {
      if (filter.status && e.status !== filter.status) return true;
      if (filter.provider && e.provider !== filter.provider) return true;
      return false;
    });
  }

  await safeWrite(db);
  return db.data.entries.length;
}

export async function getDlqStats() {
  const db = await getDlqDb();
  const entries = db.data.entries;

  const now = Date.now();
  const pendingCount = entries.filter(e => 
    e.status === "pending" && new Date(e.nextRetryAt).getTime() <= now
  ).length;

  const readyForRetry = pendingCount;

  return {
    total: entries.length,
    pending: entries.filter(e => e.status === "pending").length,
    retrying: entries.filter(e => e.status === "retrying").length,
    exhausted: entries.filter(e => e.status === "exhausted").length,
    archived: entries.filter(e => e.status === "archived").length,
    readyForRetry: pendingCount,
    byProvider: entries.reduce((acc, e) => {
      acc[e.provider] = (acc[e.provider] || 0) + 1;
      return acc;
    }, {}),
    oldestEntry: entries.length > 0 
      ? entries.reduce((oldest, e) => 
        new Date(e.timestamp) < new Date(oldest.timestamp) ? e : oldest
      ).timestamp 
      : null
  };
}

export async function pruneOldEntries(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const db = await getDlqDb();
  const cutoff = Date.now() - maxAgeMs;
  const before = db.data.entries.length;

  db.data.entries = db.data.entries.filter(e => {
    const timestamp = new Date(e.timestamp).getTime();
    if (timestamp < cutoff && e.status !== "retrying") {
      return false;
    }
    return true;
  });

  const removed = before - db.data.entries.length;
  if (removed > 0) {
    await safeWrite(db);
  }

  return removed;
}

export default {
  addToDlq,
  getDlqEntries,
  getDlqEntryById,
  updateDlqEntry,
  incrementDlqFailure,
  retryDlqEntry,
  archiveDlqEntry,
  deleteDlqEntry,
  clearDlq,
  getDlqStats,
  pruneOldEntries
};
