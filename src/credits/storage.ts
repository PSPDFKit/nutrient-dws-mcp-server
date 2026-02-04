/**
 * Credit tracking storage layer for Nutrient DWS MCP Server.
 * Uses SQLite to persist credit usage data locally.
 */

import Database from 'better-sqlite3';
import envPaths from 'env-paths';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ── Types ──────────────────────────────────────────────────────────

export type OperationType =
  | 'ocr' | 'sign' | 'redact' | 'ai-redact'
  | 'convert' | 'form-fill' | 'flatten' | 'merge'
  | 'watermark' | 'optimize' | 'estimate'
  | `multi:${string}` | 'build-unknown';

export interface InsertUsageParams {
  operation: OperationType;
  requestCost: number;
  remainingCredits: number | null;
}

export interface UsageRecord {
  id: number;
  timestamp: string;
  operation: OperationType;
  requestCost: number;
  remainingCredits: number | null;
}

export interface BalanceInfo {
  remaining: number;
  asOf: string;
}

export interface UsageSummaryRow {
  operation: string;
  count: number;
  totalCredits: number;
  avgCost: number;
}

// ── Schema ─────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS usage_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  operation         TEXT    NOT NULL,
  request_cost      REAL    NOT NULL,
  remaining_credits REAL
);

CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_operation ON usage_log(operation);
`;

// ── Singleton instance ─────────────────────────────────────────────

let _db: Database.Database | null = null;
let _insertStmt: Database.Statement | null = null;

function getDbPath(): string {
  const paths = envPaths('nutrient-dws-mcp', { suffix: '' });
  return join(paths.data, 'credits.db');
}

function getDb(): Database.Database {
  if (!_db) {
    const dbPath = getDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.exec(SCHEMA_SQL);
    
    _insertStmt = _db.prepare(`
      INSERT INTO usage_log (operation, request_cost, remaining_credits)
      VALUES (@operation, @requestCost, @remainingCredits)
    `);
  }
  return _db;
}

// ── Write Operations ───────────────────────────────────────────────

/**
 * Log a credit usage event. Called automatically after each API call.
 */
export function logUsage(params: InsertUsageParams): void {
  const db = getDb();
  if (!_insertStmt) {
    _insertStmt = db.prepare(`
      INSERT INTO usage_log (operation, request_cost, remaining_credits)
      VALUES (@operation, @requestCost, @remainingCredits)
    `);
  }
  _insertStmt.run(params);
}

// ── Read Operations ────────────────────────────────────────────────

/**
 * Get the latest known credit balance.
 */
export function getLatestBalance(): BalanceInfo | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT remaining_credits AS remaining, timestamp AS asOf
    FROM usage_log
    WHERE remaining_credits IS NOT NULL
    ORDER BY id DESC
    LIMIT 1
  `).get() as { remaining: number; asOf: string } | undefined;

  return row ? { remaining: row.remaining, asOf: row.asOf } : null;
}

/**
 * Get usage records within a date range (ISO 8601 strings).
 */
export function getUsageByPeriod(start: string, end: string): UsageRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, timestamp, operation, request_cost AS requestCost,
           remaining_credits AS remainingCredits
    FROM usage_log
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY id ASC
  `).all(start, end) as UsageRecord[];
}

/**
 * Get aggregated usage summary by operation for a date range.
 */
export function getUsageSummary(start: string, end: string): UsageSummaryRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT operation,
           COUNT(*)            AS count,
           SUM(request_cost)   AS totalCredits,
           AVG(request_cost)   AS avgCost
    FROM usage_log
    WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY operation
    ORDER BY totalCredits DESC
  `).all(start, end) as UsageSummaryRow[];
}

/**
 * Get total credits used in a date range.
 */
export function getTotalUsage(start: string, end: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(request_cost), 0) AS total
    FROM usage_log
    WHERE timestamp >= ? AND timestamp <= ?
  `).get(start, end) as { total: number };
  return row.total;
}

/**
 * Get the count of usage records (for daily rate calculation).
 */
export function getUsageCount(start: string, end: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM usage_log
    WHERE timestamp >= ? AND timestamp <= ?
  `).get(start, end) as { count: number };
  return row.count;
}

/**
 * Get the oldest and newest timestamps in the database.
 */
export function getDateRange(): { oldest: string; newest: string } | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT MIN(timestamp) AS oldest, MAX(timestamp) AS newest
    FROM usage_log
  `).get() as { oldest: string | null; newest: string | null };
  
  if (!row.oldest || !row.newest) return null;
  return { oldest: row.oldest, newest: row.newest };
}

/**
 * Close the database connection (for cleanup/testing).
 */
export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    _insertStmt = null;
  }
}

/**
 * Initialize with a custom database path (for testing).
 */
export function initDatabase(dbPath: string): void {
  closeDatabase();
  mkdirSync(dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.exec(SCHEMA_SQL);
}
