/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Friend {
  id: string;
  name: string;
}

export type SplitType = 'equal' | 'unequal' | 'percentage';

export interface Expense {
  id: string;
  title: string;
  amount: number;
  paidBy: string; // Friend ID of the person who paid
  splitAmong: string[]; // Friend IDs involved in the expense
  splitType: SplitType;
  splitDetails?: Record<string, number>; // Maps Friend ID -> split value (amount for 'unequal', percentage for 'percentage')
  date: string; // YYYY-MM-DD
  category: string; // 'Food' | 'Transport' | 'Lodging' | 'Drinks' | 'Entertainment' | 'Shopping' | 'Other'
  isSettlement?: boolean; // True if this is a "Settle Up" transaction rather than a general expense
  originalCurrency?: string; // ISO code of the currency actually paid in, if different from the group's currency (e.g. a receipt from an overseas trip)
  originalAmount?: number; // The amount in originalCurrency
  exchangeRateUsed?: number; // 1 [group currency] = X [originalCurrency], as used at save time
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  friends: Friend[];
  expenses: Expense[];
  currency: string;
  createdAt: string;
  ownerId?: string;
  syncCode?: string;
  updatedAt?: string;
  sgdExchangeRate?: number; // 1 [group currency] = X [SGD]
}

export interface Transfer {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
}

export interface CategorySpec {
  id: string;
  name: string;
  iconName: string;
  colorClass: string;
  bgColorClass: string;
}
