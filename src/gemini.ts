/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type, createUserContent, createPartFromBase64 } from '@google/genai';
import { CATEGORIES } from './utils';

export interface ScannedReceipt {
  amount: number;
  currencyCode: string;
  description: string;
  date: string;
  category: string;
}

function getClient(): GoogleGenAI {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Set VITE_GEMINI_API_KEY in .env.local.');
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Sends a photo of a receipt to Gemini and extracts structured expense data:
 * total amount, currency, a short description, the date, and a best-guess category.
 */
export async function scanReceipt(base64Data: string, mimeType: string): Promise<ScannedReceipt> {
  const ai = getClient();
  const categoryIds = CATEGORIES.map(c => c.id);
  const today = new Date().toISOString().split('T')[0];

  const response = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: createUserContent([
      createPartFromBase64(base64Data, mimeType),
      `Extract the following details from this receipt photo:
- amount: the final total amount paid (a number, no currency symbol)
- currencyCode: the ISO 4217 3-letter currency code of the receipt (e.g. SGD, THB, USD, JPY). Infer it from the currency symbol, country, or language on the receipt.
- description: a short 3-6 word description of the merchant or what was purchased
- date: the transaction date in YYYY-MM-DD format. If no date is visible, use ${today}.
- category: pick the single best match from this exact list: ${categoryIds.join(', ')}`,
    ]),
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          amount: { type: Type.NUMBER },
          currencyCode: { type: Type.STRING },
          description: { type: Type.STRING },
          date: { type: Type.STRING },
          category: { type: Type.STRING },
        },
        required: ['amount', 'currencyCode', 'description', 'date', 'category'],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  const parsed = JSON.parse(text) as ScannedReceipt;
  if (!categoryIds.includes(parsed.category)) {
    parsed.category = 'Other';
  }
  return parsed;
}

/** Reads a File as a base64 string (without the data: URL prefix) */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
