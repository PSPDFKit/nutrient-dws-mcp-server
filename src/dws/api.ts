import FormData from 'form-data'
import axios, { AxiosResponse } from 'axios'
import { getApiKey } from './utils.js'
import { getVersion } from '../version.js'
import { logUsage, type OperationType } from '../credits/index.js'

// ── Header extraction ──────────────────────────────────────────────

const CREDIT_USAGE_HEADER = 'x-pspdfkit-credit-usage';
const REMAINING_CREDITS_HEADER = 'x-pspdfkit-remaining-credits';

function extractCreditHeaders(headers: Record<string, unknown>): {
  requestCost: number;
  remainingCredits: number | null;
} | null {
  const costRaw = headers[CREDIT_USAGE_HEADER];
  const cost = typeof costRaw === 'string' ? Number(costRaw) : null;
  
  if (cost === null || !Number.isFinite(cost)) return null;
  
  const remainingRaw = headers[REMAINING_CREDITS_HEADER];
  const remaining = typeof remainingRaw === 'string' ? Number(remainingRaw) : null;
  
  return {
    requestCost: cost,
    remainingCredits: remaining !== null && Number.isFinite(remaining) ? remaining : null,
  };
}

// ── Operation classification ───────────────────────────────────────

const OPERATION_MAP: Record<string, OperationType> = {
  ocr: 'ocr',
  sign: 'sign',
  addSignature: 'sign',
  redact: 'redact',
  applyRedactions: 'redact',
  aiRedact: 'ai-redact',
  convertToPDF: 'convert',
  convertToImage: 'convert',
  convertToOffice: 'convert',
  fillFormFields: 'form-fill',
  applyInstantJson: 'form-fill',
  flatten: 'flatten',
  merge: 'merge',
  watermark: 'watermark',
  optimize: 'optimize',
};

function classifyFromInstructions(instructions: unknown): OperationType {
  try {
    const inst = instructions as { parts?: { operations?: { type?: string }[] }[] };
    const parts = inst?.parts;
    if (!Array.isArray(parts)) return 'build-unknown';

    const types = new Set<OperationType>();

    for (const part of parts) {
      const ops = part?.operations;
      if (!Array.isArray(ops)) continue;
      for (const op of ops) {
        const mapped = OPERATION_MAP[op?.type as string];
        if (mapped) types.add(mapped);
      }
    }

    if (types.size === 0) return 'build-unknown';
    if (types.size === 1) return [...types][0];

    const sorted = [...types].sort();
    return `multi:${sorted.join(',')}` as OperationType;
  } catch {
    return 'build-unknown';
  }
}

function classifyOperation(endpoint: string, data: FormData | Record<string, unknown>): OperationType {
  if (endpoint === 'ai/redact') return 'ai-redact';
  if (endpoint === 'sign') return 'sign';
  if (endpoint === 'analyze_build') return 'estimate';
  
  if (endpoint === 'build') {
    // For FormData, try to get the instructions from the 'data' field
    if (data instanceof FormData) {
      // FormData doesn't have a clean way to read fields, but we can try
      // In practice, instructions are passed as JSON in the 'data' field
      return 'build-unknown'; // Can't easily extract from FormData
    }
    // For JSON bodies, look for instructions
    const instructions = (data as { instructions?: unknown }).instructions;
    if (instructions) {
      return classifyFromInstructions(instructions);
    }
  }
  
  return 'build-unknown';
}

// ── Credit logging helper ──────────────────────────────────────────

function logCreditUsage(
  response: AxiosResponse,
  endpoint: string,
  data: FormData | Record<string, unknown>,
): void {
  try {
    const headers = extractCreditHeaders(response.headers as Record<string, unknown>);
    if (!headers) return; // Non-billable request or headers missing
    
    const operation = classifyOperation(endpoint, data);
    
    logUsage({
      operation,
      requestCost: headers.requestCost,
      remainingCredits: headers.remainingCredits,
    });
  } catch {
    // Silently fail — tracking should never break the API call
  }
}

/**
 * Makes an API call to the Nutrient API
 * @param endpoint The API endpoint to call (e.g., 'sign', 'build', 'ai/redact')
 * @param data The data to send (FormData or JSON object)
 * @param options Optional request configuration (e.g., timeout for slow endpoints)
 * @returns The API response
 */
export async function callNutrientApi(
  endpoint: string,
  data: FormData | Record<string, unknown>,
  options?: { timeout?: number },
) {
  const apiKey = getApiKey()
  const isFormData = data instanceof FormData

  const defaultHeaders: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': `NutrientDWSMCPServer/${getVersion()}`,
  }

  const headers: Record<string, string> = isFormData
    ? defaultHeaders
    : {
        ...defaultHeaders,
        'Content-Type': 'application/json',
      }
  const response = await axios.post(`https://api.nutrient.io/${endpoint}`, data, {
    headers,
    responseType: 'stream',
    timeout: options?.timeout,
  })
  
  // Log credit usage from response headers (non-blocking, fire-and-forget)
  logCreditUsage(response, endpoint, data);
  
  return response;
}
