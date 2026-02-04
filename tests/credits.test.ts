import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  initDatabase,
  closeDatabase,
  logUsage,
  getLatestBalance,
  getUsageSummary,
  getTotalUsage,
} from '../src/credits/storage.js';

import {
  getUsageSummaryAgg,
  getBalanceResult,
  getForecast,
  resolvePeriod,
} from '../src/credits/aggregator.js';

// Helper to convert Date to ISO format without milliseconds (matches SQLite format)
function toISONoMs(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

describe('Credit Storage', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'credit-test-'));
    dbPath = join(tmpDir, 'test.db');
    initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('logUsage', () => {
    it('should log a usage record', () => {
      logUsage({
        operation: 'ocr',
        requestCost: 3.0,
        remainingCredits: 997,
      });

      const balance = getLatestBalance();
      expect(balance).not.toBeNull();
      expect(balance!.remaining).toBe(997);
    });

    it('should handle null remaining credits', () => {
      logUsage({
        operation: 'sign',
        requestCost: 10.0,
        remainingCredits: null,
      });

      // Should not return null balance since we explicitly logged null
      const balance = getLatestBalance();
      expect(balance).toBeNull(); // No row with non-null remaining_credits
    });
  });

  describe('getUsageSummary', () => {
    it('should aggregate usage by operation', () => {
      const now = toISONoMs(new Date());
      const yesterday = toISONoMs(new Date(Date.now() - 24 * 60 * 60 * 1000));

      logUsage({ operation: 'ocr', requestCost: 3.0, remainingCredits: 1000 });
      logUsage({ operation: 'ocr', requestCost: 3.0, remainingCredits: 997 });
      logUsage({ operation: 'sign', requestCost: 10.0, remainingCredits: 987 });

      const summary = getUsageSummary(yesterday, now);

      expect(summary.length).toBe(2);
      
      const ocrRow = summary.find(s => s.operation === 'ocr');
      expect(ocrRow).toBeDefined();
      expect(ocrRow!.count).toBe(2);
      expect(ocrRow!.totalCredits).toBe(6.0);
      
      const signRow = summary.find(s => s.operation === 'sign');
      expect(signRow).toBeDefined();
      expect(signRow!.count).toBe(1);
      expect(signRow!.totalCredits).toBe(10.0);
    });
  });

  describe('getTotalUsage', () => {
    it('should sum all credits in period', () => {
      const now = toISONoMs(new Date());
      const yesterday = toISONoMs(new Date(Date.now() - 24 * 60 * 60 * 1000));

      logUsage({ operation: 'ocr', requestCost: 3.0, remainingCredits: 1000 });
      logUsage({ operation: 'sign', requestCost: 10.0, remainingCredits: 990 });

      const total = getTotalUsage(yesterday, now);
      expect(total).toBe(13.0);
    });

    it('should return 0 for empty period', () => {
      const future = toISONoMs(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const farFuture = toISONoMs(new Date(Date.now() + 48 * 60 * 60 * 1000));

      const total = getTotalUsage(future, farFuture);
      expect(total).toBe(0);
    });
  });
});

describe('Credit Aggregator', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'credit-agg-test-'));
    dbPath = join(tmpDir, 'test.db');
    initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolvePeriod', () => {
    it('should resolve day period', () => {
      const { start, end } = resolvePeriod('day');
      expect(new Date(start)).toBeInstanceOf(Date);
      expect(new Date(end)).toBeInstanceOf(Date);
      expect(new Date(end).getTime()).toBeGreaterThan(new Date(start).getTime());
    });

    it('should resolve week period', () => {
      const { start, end } = resolvePeriod('week');
      const startDate = new Date(start);
      const endDate = new Date(end);
      const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(6);
      expect(diffDays).toBeLessThanOrEqual(8);
    });
  });

  describe('getUsageSummaryAgg', () => {
    it('should return empty summary with no data', () => {
      const summary = getUsageSummaryAgg('week');
      expect(summary.totalCredits).toBe(0);
      expect(summary.totalOperations).toBe(0);
      expect(summary.breakdown).toEqual([]);
    });

    it('should aggregate usage correctly', () => {
      logUsage({ operation: 'ocr', requestCost: 3.0, remainingCredits: 1000 });
      logUsage({ operation: 'ocr', requestCost: 3.0, remainingCredits: 997 });

      const summary = getUsageSummaryAgg('day');
      expect(summary.totalCredits).toBe(6.0);
      expect(summary.totalOperations).toBe(2);
      expect(summary.breakdown.length).toBe(1);
      expect(summary.breakdown[0].operation).toBe('ocr');
    });
  });

  describe('getBalanceResult', () => {
    it('should return zero balance with no data', () => {
      const result = getBalanceResult();
      expect(result.remaining).toBe(0);
      expect(result.dailyRate).toBe(0);
      expect(result.daysRemaining).toBeNull();
    });

    it('should return correct balance after usage', () => {
      logUsage({ operation: 'sign', requestCost: 10.0, remainingCredits: 990 });

      const result = getBalanceResult();
      expect(result.remaining).toBe(990);
      expect(result.usedToday).toBe(10);
    });
  });

  describe('getForecast', () => {
    it('should return low confidence with no data', () => {
      const forecast = getForecast();
      expect(forecast.confidence).toBe('low');
      expect(forecast.dailyAverage).toBe(0);
      expect(forecast.daysRemaining).toBeNull();
    });

    it('should calculate forecast with data', () => {
      // Log usage to get a balance
      logUsage({ operation: 'ocr', requestCost: 30.0, remainingCredits: 970 });

      const forecast = getForecast();
      expect(forecast.dailyAverage).toBeGreaterThan(0);
      expect(forecast.confidence).toBe('low'); // Only 1 data point
    });
  });
});
