/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Friend, Expense, Transfer, CategorySpec, Group } from './types';

// Predefined currencies
export const CURRENCIES = [
  { code: 'SGD', symbol: 'S$' },
  { code: 'USD', symbol: '$' },
  { code: 'MYR', symbol: 'RM' },
  { code: 'CNY', symbol: 'CN¥' },
  { code: 'KRW', symbol: '₩' },
  { code: 'JPY', symbol: '¥' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'THB', symbol: '฿' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'HKD', symbol: 'HK$' },
  { code: 'PHP', symbol: '₱' },
  { code: 'INR', symbol: '₹' },
  { code: 'IDR', symbol: 'Rp' },
  { code: 'VND', symbol: '₫' },
];

// Predefined categories with custom colors and icons
export const CATEGORIES: CategorySpec[] = [
  { id: 'Food', name: 'Food & Dining', iconName: 'Utensils', colorClass: 'text-emerald-600', bgColorClass: 'bg-emerald-50' },
  { id: 'Transport', name: 'Transport & Fuel', iconName: 'Car', colorClass: 'text-blue-600', bgColorClass: 'bg-blue-50' },
  { id: 'Lodging', name: 'Accommodation', iconName: 'Home', colorClass: 'text-indigo-600', bgColorClass: 'bg-indigo-50' },
  { id: 'Drinks', name: 'Drinks & Nightlife', iconName: 'Coffee', colorClass: 'text-amber-600', bgColorClass: 'bg-amber-50' },
  { id: 'Entertainment', name: 'Activities & Fun', iconName: 'Compass', colorClass: 'text-fuchsia-600', bgColorClass: 'bg-fuchsia-50' },
  { id: 'Shopping', name: 'Shopping', iconName: 'ShoppingBag', colorClass: 'text-rose-600', bgColorClass: 'bg-rose-50' },
  { id: 'Other', name: 'Miscellaneous', iconName: 'CreditCard', colorClass: 'text-slate-600', bgColorClass: 'bg-slate-50' },
];

/**
 * Get default exchange rate to SGD (Singapore Dollar) for different currency symbols
 */
export function getDefaultExchangeRate(symbol: string): number {
  switch (symbol) {
    case '$': return 1.34; // Approximate USD to SGD
    case 'S$': return 1.00; // SGD to SGD
    case 'RM': return 0.31; // Approximate MYR to SGD
    case 'CN¥': return 0.19; // Approximate CNY to SGD
    case '₩': return 0.0010; // Approximate KRW to SGD
    case '¥': return 0.0089; // Approximate JPY to SGD
    case 'A$': return 0.89; // Approximate AUD to SGD
    default: return 1.00;
  }
}

/**
 * Fetch a live exchange rate between two ISO currency codes for a given date,
 * expressed as "1 fromCode = X toCode" (e.g. fromCode='SGD', toCode='THB').
 * Uses the free, no-API-key Frankfurter API (European Central Bank reference rates).
 * Returns null if the lookup fails (unsupported currency, offline, etc.) so callers
 * can fall back to manual entry.
 */
export async function fetchExchangeRate(fromCode: string, toCode: string, dateStr?: string): Promise<number | null> {
  if (fromCode === toCode) return 1;
  try {
    const today = new Date().toISOString().split('T')[0];
    const datePath = dateStr && dateStr <= today ? dateStr : 'latest';
    const res = await fetch(`https://api.frankfurter.dev/v1/${datePath}?base=${fromCode}&symbols=${toCode}`);
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data?.rates?.[toCode];
    return typeof rate === 'number' ? rate : null;
  } catch (err) {
    console.error('Failed to fetch exchange rate:', err);
    return null;
  }
}

/**
 * Scale the expense values and multi-user split details for display conversion
 */
export function getConvertedExpenses(expenses: Expense[], multiplier: number): Expense[] {
  if (!multiplier || Math.abs(multiplier - 1.0) < 0.0001) return expenses;
  return expenses.map(e => {
    const updated: Expense = {
      ...e,
      amount: Number((e.amount * multiplier).toFixed(2)),
    };
    if (e.splitDetails) {
      const details: Record<string, number> = {};
      Object.entries(e.splitDetails).forEach(([id, val]) => {
        if (e.splitType === 'unequal') {
          // Unequal values represent exact amounts in base currency, which must be converted
          details[id] = Number((val * multiplier).toFixed(2));
        } else {
          // Percentages or shares are currency-agnostic
          details[id] = val;
        }
      });
      updated.splitDetails = details;
    }
    return updated;
  });
}

/**
 * Format dynamic currency amount nicely
 */
export function formatCurrency(amount: number, currencySymbol: string): string {
  // Avoid negative sign issues for very small floating point numbers
  const cleanAmount = Math.abs(amount) < 0.005 ? 0 : amount;
  return `${currencySymbol}${cleanAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Calculate the total spending inside a group
 */
export function calculateGroupTotal(expenses: Expense[]): number {
  return expenses
    .filter(e => !e.isSettlement)
    .reduce((sum, e) => sum + e.amount, 0);
}

/**
 * Calculates net balance for each member in a group.
 * Positive means people owe them money (creditor).
 * Negative means they owe money (debtor).
 */
export function calculateBalances(friends: Friend[], expenses: Expense[]): Record<string, number> {
  const balances: Record<string, number> = {};
  
  // Initialize balances to 0 for everyone
  friends.forEach(f => {
    balances[f.id] = 0;
  });

  expenses.forEach(expense => {
    const { amount, paidBy, splitAmong, splitType, splitDetails } = expense;

    // 1. Credit the payer
    if (balances[paidBy] !== undefined) {
      balances[paidBy] += amount;
    }

    // 2. Debit the split participants
    if (splitType === 'equal') {
      const share = amount / splitAmong.length;
      splitAmong.forEach(memberId => {
        if (balances[memberId] !== undefined) {
          balances[memberId] -= share;
        }
      });
    } else if (splitType === 'unequal' && splitDetails) {
      splitAmong.forEach(memberId => {
        const share = splitDetails[memberId] ?? 0;
        if (balances[memberId] !== undefined) {
          balances[memberId] -= share;
        }
      });
    } else if (splitType === 'percentage' && splitDetails) {
      splitAmong.forEach(memberId => {
        const pct = splitDetails[memberId] ?? 0;
        const share = (pct / 100) * amount;
        if (balances[memberId] !== undefined) {
          balances[memberId] -= share;
        }
      });
    }
  });

  return balances;
}

/**
 * Greedy algorithm to settle debts with minimum number of transactions
 */
export function calculateSettlements(friends: Friend[], expenses: Expense[]): Transfer[] {
  const balances = calculateBalances(friends, expenses);
  const settlements: Transfer[] = [];

  // Prepare creditors and debtors lists
  const creditors: { id: string; name: string; balance: number }[] = [];
  const debtors: { id: string; name: string; balance: number }[] = [];

  Object.entries(balances).forEach(([id, balance]) => {
    const friend = friends.find(f => f.id === id);
    if (!friend) return;

    if (balance > 0.005) {
      creditors.push({ id, name: friend.name, balance });
    } else if (balance < -0.005) {
      debtors.push({ id, name: friend.name, balance: Math.abs(balance) });
    }
  });

  // Sort creditors descending, debtors descending
  creditors.sort((a, b) => b.balance - a.balance);
  debtors.sort((a, b) => b.balance - a.balance);

  let cIdx = 0;
  let dIdx = 0;

  while (cIdx < creditors.length && dIdx < debtors.length) {
    const creditor = creditors[cIdx];
    const debtor = debtors[dIdx];

    const amountToTransfer = Math.min(creditor.balance, debtor.balance);

    if (amountToTransfer > 0.005) {
      settlements.push({
        fromId: debtor.id,
        fromName: debtor.name,
        toId: creditor.id,
        toName: creditor.name,
        amount: Number(amountToTransfer.toFixed(2)),
      });
    }

    creditor.balance -= amountToTransfer;
    debtor.balance -= amountToTransfer;

    if (creditor.balance < 0.005) {
      cIdx++;
    }
    if (debtor.balance < 0.005) {
      dIdx++;
    }
  }

  return settlements;
}

/**
 * Pre-generate text to share on WhatsApp or other messaging apps
 */
export function generateShareableSummary(groupName: string, settlements: Transfer[], currencySymbol: string): string {
  if (settlements.length === 0) {
    return `🎉 All settled up for group: ${groupName}! No outstanding debts to record.`;
  }

  let text = `✈️ *Expenses Settlement: ${groupName}* \n\n`;
  text += `Here's how we can settle up easily with the minimum number of transfers:\n\n`;
  
  settlements.forEach((t, i) => {
    const formatted = formatCurrency(t.amount, currencySymbol);
    text += `${i + 1}. *${t.fromName}* ➡️ pay *${t.toName}*:   _${formatted}_\n`;
  });
  
  text += `\nThank you everyone! 🙌`;
  return text;
}

/**
 * Generate a nice default example group to pre-populate the app so users can see how it works instantly.
 */
export function getDemoGroup(): Group {
  const weirenId = 'f-weiren';
  const bobId = 'f-bob';
  const charlieId = 'f-charlie';
  const daveId = 'f-dave';

  const friends: Friend[] = [
    { id: weirenId, name: 'weiren' },
    { id: bobId, name: 'Bob' },
    { id: charlieId, name: 'Charlie' },
    { id: daveId, name: 'Dave' },
  ];

  const expenses: Expense[] = [
    {
      id: 'e-1',
      title: 'Group Villa Booking',
      amount: 400.00,
      paidBy: weirenId,
      splitAmong: [weirenId, bobId, charlieId, daveId],
      splitType: 'equal',
      date: '2026-05-20',
      category: 'Lodging',
    },
    {
      id: 'e-2',
      title: 'Korean BBQ Dinner',
      amount: 120.00,
      paidBy: bobId,
      splitAmong: [weirenId, bobId, charlieId, daveId],
      splitType: 'equal',
      date: '2026-05-21',
      category: 'Food',
    },
    {
      id: 'e-3',
      title: 'Rental Car Hire & Petrol',
      amount: 80.00,
      paidBy: charlieId,
      splitAmong: [weirenId, bobId, charlieId, daveId],
      splitType: 'equal',
      date: '2026-05-21',
      category: 'Transport',
    },
    {
      id: 'e-4',
      title: 'Craft Beer Tasting (Bob & Charlie only)',
      amount: 45.00,
      paidBy: daveId,
      splitAmong: [bobId, charlieId],
      splitType: 'equal',
      date: '2026-05-22',
      category: 'Drinks',
    },
    {
      id: 'e-5',
      title: 'Souvenir magnets (Unequal split)',
      amount: 30.00,
      paidBy: weirenId,
      splitAmong: [weirenId, bobId, charlieId],
      splitType: 'unequal',
      splitDetails: {
        [weirenId]: 15.00, // bought $15 worth
        [bobId]: 10.00,   // bought $10 worth
        [charlieId]: 5.00, // bought $5 worth
      },
      date: '2026-05-23',
      category: 'Shopping',
    },
    {
      id: 'e-settled-1',
      title: 'Settle Up: Dave pays weiren',
      amount: 100.00,
      paidBy: daveId,
      splitAmong: [weirenId],
      splitType: 'equal',
      date: '2026-05-24',
      category: 'Other',
      isSettlement: true,
    }
  ];

  return {
    id: 'demo-group-id',
    name: 'Bangkok Getaway 🇹🇭',
    description: 'Weekend trip with the close college buddies',
    friends,
    expenses,
    currency: '$',
    createdAt: '2026-05-20T10:00:00.000Z',
  };
}

/**
 * Generate a clean, easily readable 6-character uppercase short code
 */
export function generateSyncCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Easily readable characters, no O, 0, I, 1
  let result = '';
  const cryptoObj = typeof window !== 'undefined' ? (window.crypto || (window as any).msCrypto) : null;
  if (cryptoObj) {
    const array = new Uint32Array(6);
    cryptoObj.getRandomValues(array);
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(array[i] % chars.length);
    }
  } else {
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  return result;
}

