import crypto from 'crypto';

const IDEMPOTENCY_PREFIX = 'idemp';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function generateIdempotencyKey(request, options = {}) {
  const payload = {
    model: request.model,
    messages: normalizeMessages(request.messages),
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    max_completion_tokens: request.max_completion_tokens,
    top_p: request.top_p,
    frequency_penalty: request.frequency_penalty,
    presence_penalty: request.presence_penalty,
    tools: options.includeTools ? request.tools : undefined,
    tool_choice: options.includeTools ? request.tool_choice : undefined
  };

  Object.keys(payload).forEach(key => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });

  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 32);

  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');

  return `${IDEMPOTENCY_PREFIX}-${hash}-${timestamp}-${random}`;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  
  return messages.map(msg => {
    const normalized = { role: msg.role };
    
    if (typeof msg.content === 'string') {
      normalized.content = msg.content.slice(0, 1000);
    } else if (Array.isArray(msg.content)) {
      normalized.content = msg.content.map(c => {
        if (c.type === 'text') {
          return { type: 'text', text: c.text?.slice(0, 500) || '' };
        }
        return { type: c.type };
      });
    }
    
    return normalized;
  });
}

export function parseIdempotencyKey(key) {
  if (!key || !key.startsWith(IDEMPOTENCY_PREFIX)) {
    return null;
  }

  const parts = key.split('-');
  if (parts.length < 4) {
    return null;
  }

  return {
    prefix: parts[0],
    hash: parts[1],
    timestamp: parseInt(parts[2], 10),
    random: parts[3],
    isValid: true,
    age: Date.now() - parseInt(parts[2], 10)
  };
}

export function isIdempotencyKeyValid(key) {
  const parsed = parseIdempotencyKey(key);
  if (!parsed) return false;
  
  return parsed.age < IDEMPOTENCY_TTL_MS;
}

export function getIdempotencyKeyAge(key) {
  const parsed = parseIdempotencyKey(key);
  return parsed?.age ?? null;
}

export class IdempotencyStore {
  constructor() {
    this.store = new Map();
    this.maxSize = 10000;
  }

  set(key, response) {
    if (this.store.size >= this.maxSize) {
      this.cleanup();
    }
    
    this.store.set(key, {
      response,
      timestamp: Date.now()
    });
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      this.store.delete(key);
      return null;
    }
    
    return entry.response;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.store.delete(key);
  }

  cleanup() {
    const now = Date.now();
    const expiredKeys = [];
    
    for (const [key, entry] of this.store) {
      if (now - entry.timestamp > IDEMPOTENCY_TTL_MS) {
        expiredKeys.push(key);
      }
    }
    
    expiredKeys.forEach(key => this.store.delete(key));
    
    if (this.store.size >= this.maxSize) {
      const entries = Array.from(this.store.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toDelete = entries.slice(0, Math.floor(this.maxSize * 0.2));
      toDelete.forEach(([key]) => this.store.delete(key));
    }
  }

  clear() {
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}

export const globalIdempotencyStore = new IdempotencyStore();

export default {
  generateIdempotencyKey,
  parseIdempotencyKey,
  isIdempotencyKeyValid,
  getIdempotencyKeyAge,
  IdempotencyStore,
  globalIdempotencyStore
};
