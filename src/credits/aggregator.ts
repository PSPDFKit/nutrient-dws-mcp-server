/**
 * Credit usage aggregation and forecasting for Nutrient DWS MCP Server.
 */

import {
  getLatestBalance,
  getUsageByPeriod,
  getUsageSummary as getUsageSummaryFromDb,
  getTotalUsage,
  getDateRange,
} from './storage.js';

// ── Types ──────────────────────────────────────────────────────────

export type Period = 'day' | 'week' | 'month' | 'all';

export interface UsageSummary {
  period: { start: string; end: string };
  totalCredits: number;
  totalOperations: number;
  breakdown: Array<{
    operation: string;
    count: number;
    credits: number;
    avgCost: number;
  }>;
}

export interface BalanceResult {
  remaining: number;
  asOf: string;
  usedToday: number;
  usedThisWeek: number;
  usedThisMonth: number;
  dailyRate: number;
  daysRemaining: number | null;
  exhaustionDate: string | null;
  confidence: 'low' | 'medium' | 'high';
}

export interface Forecast {
  dailyAverage: number;
  daysRemaining: number | null;
  exhaustionDate: string | null;
  confidence: 'low' | 'medium' | 'high';
}

// ── Period resolution ──────────────────────────────────────────────

/**
 * Convert a Date to ISO format without milliseconds (to match SQLite format).
 * SQLite stores as 'YYYY-MM-DDTHH:MM:SSZ', JS Date.toISOString() returns 'YYYY-MM-DDTHH:MM:SS.sssZ'.
 */
function toISONoMs(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function resolvePeriod(period: Period): { start: string; end: string } {
  const now = new Date();

  switch (period) {
    case 'day': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start: toISONoMs(start), end: toISONoMs(now) };
    }

    case 'week': {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { start: toISONoMs(start), end: toISONoMs(now) };
    }

    case 'month': {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { start: toISONoMs(start), end: toISONoMs(now) };
    }

    case 'all': {
      return {
        start: '1970-01-01T00:00:00Z',
        end: '2099-12-31T23:59:59Z',
      };
    }
  }
}

// ── Aggregator functions ───────────────────────────────────────────

export function getUsageSummaryAgg(period: Period): UsageSummary {
  const range = resolvePeriod(period);
  const rows = getUsageSummaryFromDb(range.start, range.end);

  const breakdown = rows.map((r) => ({
    operation: r.operation,
    count: r.count,
    credits: r.totalCredits,
    avgCost: r.avgCost,
  }));

  const totalCredits = breakdown.reduce((sum, b) => sum + b.credits, 0);
  const totalOperations = breakdown.reduce((sum, b) => sum + b.count, 0);

  return { period: range, totalCredits, totalOperations, breakdown };
}

// ── Forecaster ─────────────────────────────────────────────────────

export function getForecast(): Forecast {
  const balance = getLatestBalance();

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const start = toISONoMs(thirtyDaysAgo);
  const end = toISONoMs(now);
  const usage = getUsageByPeriod(start, end);

  if (usage.length === 0) {
    return {
      dailyAverage: 0,
      daysRemaining: null,
      exhaustionDate: null,
      confidence: 'low',
    };
  }

  // Total credits consumed in the window
  const totalCredits = usage.reduce((sum, u) => sum + u.requestCost, 0);

  // Count unique days with usage (data points for confidence)
  const uniqueDays = new Set(
    usage.map((u) => u.timestamp.slice(0, 10)),
  ).size;

  // Daily average over the full 30-day window
  const daysInRange = 30;
  const dailyAverage = totalCredits / daysInRange;

  // Confidence
  const confidence = computeConfidence(uniqueDays);

  // Days remaining
  if (!balance || dailyAverage === 0) {
    return { dailyAverage, daysRemaining: null, exhaustionDate: null, confidence };
  }

  const daysRemaining = balance.remaining / dailyAverage;
  const exhaustionDate = new Date(now);
  exhaustionDate.setDate(exhaustionDate.getDate() + Math.ceil(daysRemaining));

  return {
    dailyAverage,
    daysRemaining,
    exhaustionDate: exhaustionDate.toISOString().slice(0, 10),
    confidence,
  };
}

function computeConfidence(dataPoints: number): 'low' | 'medium' | 'high' {
  if (dataPoints >= 30) return 'high';
  if (dataPoints >= 7) return 'medium';
  return 'low';
}

// ── Combined balance info ──────────────────────────────────────────

export function getBalanceResult(): BalanceResult {
  const balance = getLatestBalance();
  const forecast = getForecast();

  const dayRange = resolvePeriod('day');
  const weekRange = resolvePeriod('week');
  const monthRange = resolvePeriod('month');

  const usedToday = getTotalUsage(dayRange.start, dayRange.end);
  const usedThisWeek = getTotalUsage(weekRange.start, weekRange.end);
  const usedThisMonth = getTotalUsage(monthRange.start, monthRange.end);

  return {
    remaining: balance?.remaining ?? 0,
    asOf: balance?.asOf ?? new Date().toISOString(),
    usedToday,
    usedThisWeek,
    usedThisMonth,
    dailyRate: forecast.dailyAverage,
    daysRemaining: forecast.daysRemaining,
    exhaustionDate: forecast.exhaustionDate,
    confidence: forecast.confidence,
  };
}
