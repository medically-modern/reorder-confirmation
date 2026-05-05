// ============================================================
// Redis Token Service
// ============================================================

import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { TokenRecord, PatientOrderResponse } from "./types";

// --- Singleton Redis client ---
let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL not set");
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      },
    });
  }
  return redisClient;
}

const TOKEN_PREFIX = "reorder:token:";
const ITEM_PREFIX = "reorder:item:";

// --- Generate a new token for a Monday item ---
export async function createToken(
  mondayItemId: string,
  boardId: string
): Promise<string> {
  const redis = getRedis();
  const token = uuidv4();

  const record: TokenRecord = {
    mondayItemId,
    boardId,
    createdAt: new Date().toISOString(),
  };

  // Store token → record
  await redis.set(
    `${TOKEN_PREFIX}${token}`,
    JSON.stringify(record)
  );

  // Store item → token (for reverse lookup / regeneration)
  await redis.set(`${ITEM_PREFIX}${mondayItemId}`, token);

  return token;
}

// --- Look up a token → get the item record ---
export async function lookupToken(
  token: string
): Promise<TokenRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(`${TOKEN_PREFIX}${token}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as TokenRecord;
  } catch {
    return null;
  }
}

// --- Mark a token as submitted ---
export async function markTokenSubmitted(
  token: string,
  orderResponse: PatientOrderResponse
): Promise<void> {
  const redis = getRedis();
  const record = await lookupToken(token);
  if (!record) throw new Error("Token not found");

  record.submittedAt = new Date().toISOString();
  record.orderResponse = orderResponse;

  await redis.set(
    `${TOKEN_PREFIX}${token}`,
    JSON.stringify(record)
  );
}

// --- Check if a token has already been submitted ---
export async function isTokenSubmitted(token: string): Promise<boolean> {
  const record = await lookupToken(token);
  return !!record?.submittedAt;
}

// --- Get existing token for an item (if any) ---
export async function getTokenForItem(
  mondayItemId: string
): Promise<string | null> {
  const redis = getRedis();
  return redis.get(`${ITEM_PREFIX}${mondayItemId}`);
}

// --- Delete a token (cleanup) ---
export async function deleteToken(token: string): Promise<void> {
  const redis = getRedis();
  const record = await lookupToken(token);
  if (record) {
    await redis.del(`${ITEM_PREFIX}${record.mondayItemId}`);
  }
  await redis.del(`${TOKEN_PREFIX}${token}`);
}

// --- Log a submission event (for debugging) ---
export async function logSubmission(
  token: string,
  data: Record<string, unknown>
): Promise<void> {
  const redis = getRedis();
  const logKey = `reorder:log:${token}`;
  const entry = {
    timestamp: new Date().toISOString(),
    ...data,
  };
  await redis.rpush(logKey, JSON.stringify(entry));
  // Keep logs for 90 days
  await redis.expire(logKey, 90 * 24 * 60 * 60);
}

// --- Get submission logs for a token ---
export async function getSubmissionLogs(
  token: string
): Promise<Record<string, unknown>[]> {
  const redis = getRedis();
  const logs = await redis.lrange(`reorder:log:${token}`, 0, -1);
  return logs.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { raw: l };
    }
  });
}
