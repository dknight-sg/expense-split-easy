/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  X, Check, Calendar, DollarSign, Users, AlertCircle, Trash2, 
  Utensils, Car, Home, Coffee, Compass, ShoppingBag, CreditCard, Sparkles 
} from 'lucide-react';
import { Expense, Friend, SplitType } from '../types';
import { CATEGORIES, getDefaultExchangeRate, CURRENCIES } from '../utils';

// Helper to render dynamic Lucide icons cleanly
export function getCategoryIcon(iconName: string, className = 'w-5 h-5') {
  switch (iconName) {
    case 'Utensils': return <Utensils className={className} />;
    case 'Car': return <Car className={className} />;
    case 'Home': return <Home className={className} />;
    case 'Coffee': return <Coffee className={className} />;
    case 'Compass': return <Compass className={className} />;
    case 'ShoppingBag': return <ShoppingBag className={className} />;
    default: return <CreditCard className={className} />;
  }
}

interface ExpenseFormProps {
  key?: string | number | null;
  friends: Friend[];
  currencySymbol: string;
  expenseToEdit?: Expense | null;
  sgdExchangeRate?: number;
  onSave: (expense: Omit<Expense, 'id'> & { id?: string }) => void;
  onCancel: () => void;
  onDelete?: (id: string) => void;
}

export default function ExpenseForm({
  friends,
  currencySymbol,
  expenseToEdit,
  sgdExchangeRate = 1.34,
  onSave,
  onCancel,
  onDelete
}: ExpenseFormProps) {
  const baseCurrencyCode = CURRENCIES.find(c => c.symbol === currencySymbol)?.code || currencySymbol;

  // New currency selection states
  const [inputInSgd, setInputInSgd] = useState<boolean>(expenseToEdit?.originalCurrency === 'SGD');
  const [customExchangeRate, setCustomExchangeRate] = useState<string>(
    expenseToEdit?.exchangeRateUsed 
      ? expenseToEdit.exchangeRateUsed.toString() 
      : sgdExchangeRate.toString()
  );

  // If editing, load original state, else set standard defaults
  const [title, setTitle] = useState(expenseToEdit?.title || '');
  
  // Set initial display amount based on original recording currency
  const [amountStr, setAmountStr] = useState(() => {
    if (expenseToEdit) {
      if (expenseToEdit.originalCurrency === 'SGD' && expenseToEdit.sgdAmount) {
        return expenseToEdit.sgdAmount.toString();
      }
      return expenseToEdit.amount.toString();
    }
    return '';
  });

  const [paidBy, setPaidBy] = useState(expenseToEdit?.paidBy || (friends[0]?.id || ''));
  const [splitAmong, setSplitAmong] = useState<string[]>(
    expenseToEdit?.splitAmong || friends.map(f => f.id)
  );
  const [splitType, setSplitType] = useState<SplitType>(expenseToEdit?.splitType || 'equal');
  const [category, setCategory] = useState(expenseToEdit?.category || 'Food');
  const [date, setDate] = useState(
    expenseToEdit?.date || new Date().toISOString().split('T')[0]
  );

  // Split details map: ID -> value (amount or percentage)
  const [splitDetails, setSplitDetails] = useState<Record<string, string>>(() => {
    if (expenseToEdit?.splitDetails) {
      const initial: Record<string, string> = {};
      Object.entries(expenseToEdit.splitDetails).forEach(([id, val]) => {
        // If originally recorded in SGD, display initial unequal shares in SGD (multiply by exchange rate)
        if (expenseToEdit.originalCurrency === 'SGD' && expenseToEdit.exchangeRateUsed) {
          initial[id] = (val * expenseToEdit.exchangeRateUsed).toFixed(2);
        } else {
          initial[id] = val.toString();
        }
      });
      return initial;
    }
    return {};
  });

  const parsedAmount = parseFloat(amountStr) || 0;
  const activeRate = parseFloat(customExchangeRate) || sgdExchangeRate || 1.34;
  const activeAmountInGroupCurrency = inputInSgd ? (parsedAmount / activeRate) : parsedAmount;

  // Handle dynamic currency recording toggle with on-the-fly conversion so no data is lost
  const handleToggleInputCurrency = (targetSgd: boolean) => {
    if (targetSgd === inputInSgd) return;
    const currentVal = parseFloat(amountStr) || 0;
    
    if (targetSgd) {
      const converted = currentVal * activeRate;
      setAmountStr(converted > 0 ? Number(converted.toFixed(2)).toString() : '');
      
      // Also scale split details if they are unequal amounts
      if (splitType === 'unequal') {
        const nextDetails = { ...splitDetails };
        Object.keys(nextDetails).forEach(id => {
          const detailValue = parseFloat(nextDetails[id]) || 0;
          nextDetails[id] = detailValue > 0 ? Number((detailValue * activeRate).toFixed(2)).toString() : '';
        });
        setSplitDetails(nextDetails);
      }
    } else {
      const converted = currentVal / activeRate;
      setAmountStr(converted > 0 ? Number(converted.toFixed(2)).toString() : '');
      
      // Scale split details back to group currency
      if (splitType === 'unequal') {
        const nextDetails = { ...splitDetails };
        Object.keys(nextDetails).forEach(id => {
          const detailValue = parseFloat(nextDetails[id]) || 0;
          nextDetails[id] = detailValue > 0 ? Number((detailValue / activeRate).toFixed(2)).toString() : '';
        });
        setSplitDetails(nextDetails);
      }
    }
    setInputInSgd(targetSgd);
  };

  // Auto-fill split values when list or splitting format changes to guide users
  useEffect(() => {
    if (!expenseToEdit) {
      // For unequal split, auto-divide equally to prepare fields
      if (splitType === 'unequal' && parsedAmount > 0 && splitAmong.length > 0) {
        const equalShare = (parsedAmount / splitAmong.length).toFixed(2);
        const temp: Record<string, string> = {};
        splitAmong.forEach(id => {
          temp[id] = equalShare;
        });
        setSplitDetails(temp);
      } else if (splitType === 'percentage' && splitAmong.length > 0) {
        const equalPct = Math.floor(100 / splitAmong.length).toString();
        const temp: Record<string, string> = {};
        splitAmong.forEach(id => {
          temp[id] = equalPct;
        });
        setSplitDetails(temp);
      }
    }
  }, [splitType, splitAmong.length]);

  // Handle participant toggling
  const handleToggleParticipant = (friendId: string) => {
    if (splitAmong.includes(friendId)) {
      // Don't empty out participants entirely
      if (splitAmong.length > 1) {
        setSplitAmong(splitAmong.filter(id => id !== friendId));
        // Remove from splitDetails
        const updated = { ...splitDetails };
        delete updated[friendId];
        setSplitDetails(updated);
      }
    } else {
      setSplitAmong([...splitAmong, friendId]);
    }
  };

  const handleDetailChange = (friendId: string, val: string) => {
    setSplitDetails(prev => ({
      ...prev,
      [friendId]: val
    }));
  };

  // Calculations for Validation Status
  const getValidationStatus = () => {
    if (!title.trim()) {
      return { isValid: false, message: 'Please enter a description or bill name.' };
    }
    if (parsedAmount <= 0) {
      return { isValid: false, message: 'Please enter an amount greater than zero.' };
    }
    if (splitAmong.length === 0) {
      return { isValid: false, message: 'Please select at least one person to split with.' };
    }

    if (splitType === 'unequal') {
      let sum = 0;
      splitAmong.forEach(id => {
        sum += parseFloat(splitDetails[id]) || 0;
      });
      const diff = parsedAmount - sum;
      if (Math.abs(diff) > 0.01) {
        const formattedDiff = Math.abs(diff).toFixed(2);
        return {
          isValid: false,
          message: `The sum of shares does not match total amount. Diff: ${diff > 0 ? '+' : '-'}${inputInSgd ? 'S$' : currencySymbol}${formattedDiff}`,
          diff
        };
      }
    }

    if (splitType === 'percentage') {
      let sum = 0;
      splitAmong.forEach(id => {
        sum += parseFloat(splitDetails[id]) || 0;
      });
      const diff = 100 - sum;
      if (Math.abs(diff) > 0.1) {
        return {
          isValid: false,
          message: `Percentages must total 100%. Current total: ${sum}% (${diff > 0 ? '+' : ''}${diff.toFixed(1)}% remaining)`,
          diff
        };
      }
    }

    return { isValid: true, message: '' };
  };

  const { isValid, message } = getValidationStatus();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    // Convert total and shares back to group base currency if entered in SGD
    const finalAmount = inputInSgd 
      ? Number(activeAmountInGroupCurrency.toFixed(2)) 
      : parsedAmount;

    // Package split details back to record of numbers
    const finalDetails: Record<string, number> = {};
    if (splitType !== 'equal') {
      splitAmong.forEach(id => {
        const valInSgdOrBase = parseFloat(splitDetails[id]) || 0;
        if (splitType === 'unequal') {
          // Convert SGD shares back to the base currency
          finalDetails[id] = inputInSgd 
            ? Number((valInSgdOrBase / activeRate).toFixed(2)) 
            : valInSgdOrBase;
        } else {
          // Percentages don't need any currency conversion
          finalDetails[id] = valInSgdOrBase;
        }
      });
    }

    onSave({
      ...(expenseToEdit?.id ? { id: expenseToEdit.id } : {}),
      title: title.trim(),
      amount: finalAmount,
      paidBy,
      splitAmong,
      splitType,
      splitDetails: splitType !== 'equal' ? finalDetails : undefined,
      category,
      date,
      isSettlement: expenseToEdit?.isSettlement || false,
      originalCurrency: inputInSgd ? 'SGD' : undefined,
      sgdAmount: inputInSgd ? parsedAmount : undefined,
      exchangeRateUsed: inputInSgd ? activeRate : undefined,
    });
  };

  return (
    <div className="bg-white rounded-2xl md:shadow-xl border border-slate-100 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
        <div>
          <h3 className="text-lg font-semibold text-slate-800 font-display">
            {expenseToEdit ? (expenseToEdit.isSettlement ? 'Edit Settlement' : 'Edit Expense') : 'Add New Bill / Expense'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Enter transaction details below</p>
        </div>
        <button
          onClick={onCancel}
          className="p-1.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
          type="button"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Form Area */}
      <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        
        {/* Value Big Input */}
        <div className="bg-indigo-50/30 rounded-2xl p-4 border border-indigo-100/50 space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-indigo-800 uppercase tracking-wider">
              How much was spent?
            </label>
            
            {/* Record currency toggle button */}
            {currencySymbol !== 'S$' && (
              <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => handleToggleInputCurrency(false)}
                  className={`px-2 py-0.5 rounded transition-all ${
                    !inputInSgd
                      ? 'bg-white text-slate-800 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {baseCurrencyCode} Base ({currencySymbol})
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleInputCurrency(true)}
                  className={`px-2 py-0.5 rounded flex items-center space-x-1 transition-all ${
                    inputInSgd
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>SGD (S$)</span>
                  <Sparkles className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
                </button>
              </div>
            )}
          </div>
          
          <div className="relative flex items-center">
            <span className="font-display text-2xl font-bold text-indigo-600 mr-2">
              {inputInSgd ? 'S$' : currencySymbol}
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full bg-transparent border-none text-3xl font-display font-semibold text-slate-900 focus:outline-none focus:ring-0 p-0"
              required
              autoFocus={!expenseToEdit}
            />
          </div>

          {/* S$ conversion details if active */}
          {inputInSgd && currencySymbol !== 'S$' && (
            <div className="mt-2 pt-2.5 border-t border-indigo-100/50 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2 font-medium">
              <div>
                Equivalent Trip Cost:{' '}
                <span className="font-bold text-indigo-700 font-mono">
                  {currencySymbol}{activeAmountInGroupCurrency.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center space-x-1.5 bg-white border border-slate-200 rounded-lg px-2 py-0.5">
                <span className="text-[10px] text-slate-400">Rate: 1 {currencySymbol} =</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={customExchangeRate}
                  onChange={(e) => setCustomExchangeRate(e.target.value)}
                  className="w-16 text-center font-bold font-mono text-slate-800 focus:outline-none p-0 text-xs inline bg-transparent"
                />
                <span className="text-[10px] text-slate-450">SGD</span>
              </div>
            </div>
          )}
        </div>

        {/* Title Input */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">What was this for?</label>
          <input
            type="text"
            placeholder="e.g. Seafood Dinner, Fuel, Airbnb deposit"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full h-11 px-3.5 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-slate-700 placeholder-slate-400 transition-all text-sm"
            required
            maxLength={60}
          />
        </div>

        {/* Category horizontal list */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 mb-1">Pick a Category</label>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {CATEGORIES.map(cat => {
              const matches = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all text-center ${
                    matches
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-500/20 font-medium'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-500 dark:hover:bg-slate-50'
                  }`}
                >
                  <div className={`p-1.5 rounded-lg mb-1 ${matches ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-600'}`}>
                    {getCategoryIcon(cat.iconName, 'w-4 h-4')}
                  </div>
                  <span className="text-[10px] tracking-tight leading-tight block truncate w-full select-none">
                    {cat.name.split(' & ')[0]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Date and Who Paid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Paid By</label>
            <div className="relative">
              <select
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value)}
                className="w-full h-11 pl-3.5 pr-8 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-slate-700 bg-white hover:bg-slate-50 transition-all text-sm appearance-none"
              >
                {friends.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                <Users className="w-4 h-4 mr-1.5" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Date</label>
            <div className="relative">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer transition-all text-sm"
                required
              />
            </div>
          </div>
        </div>

        {/* Split Methods selection */}
        <div className="border-t border-slate-100 pt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">How should this be split?</label>
            <div className="flex p-0.5 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setSplitType('equal')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all text-center ${
                  splitType === 'equal'
                    ? 'bg-white text-slate-800 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Equally
              </button>
              <button
                type="button"
                onClick={() => setSplitType('unequal')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all text-center ${
                  splitType === 'unequal'
                    ? 'bg-white text-slate-800 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Unequally
              </button>
              <button
                type="button"
                onClick={() => setSplitType('percentage')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all text-center ${
                  splitType === 'percentage'
                    ? 'bg-white text-slate-800 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                By Percentage
              </button>
            </div>
          </div>

          {/* Members splitting checklist */}
          <div className="space-y-2">
            <div className="flex justify-between items-center bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
              <span className="text-xs font-medium text-slate-500">Split among:</span>
              <button
                type="button"
                onClick={() => {
                  if (splitAmong.length === friends.length) {
                    setSplitAmong([friends[0].id]);
                  } else {
                    setSplitAmong(friends.map(f => f.id));
                  }
                }}
                className="text-[10px] text-indigo-600 hover:text-indigo-700 font-semibold"
              >
                {splitAmong.length === friends.length ? 'Select One' : 'Select All'}
              </button>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden bg-white">
              {friends.map(friend => {
                const isSelected = splitAmong.includes(friend.id);
                return (
                  <div
                    key={friend.id}
                    className={`flex items-center justify-between px-3.5 py-2.5 transition-all ${
                      isSelected ? 'bg-indigo-50/10' : 'opacity-65 bg-slate-50/20'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleParticipant(friend.id)}
                      className="flex items-center space-x-3 text-left focus:outline-none flex-1 py-1 select-none"
                    >
                      <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                        isSelected 
                          ? 'bg-indigo-600 border-indigo-600 text-white' 
                          : 'border-slate-300 text-transparent bg-white'
                      }`}>
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-700">{friend.name}</p>
                        {splitType === 'equal' && isSelected && parsedAmount > 0 && (
                          <p className="text-[10px] text-slate-500 font-mono">
                            owes {inputInSgd ? 'S$' : currencySymbol}{(parsedAmount / splitAmong.length).toFixed(2)}
                            {inputInSgd && (
                              <span className="text-slate-400 font-normal">
                                {' '}
                                ({currencySymbol}{((parsedAmount / activeRate) / splitAmong.length).toFixed(2)})
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </button>

                    {/* Render unequal input */}
                    {splitType === 'unequal' && isSelected && (
                      <div className="flex items-center space-x-1.5 max-w-[120px]">
                        <span className="text-xs text-slate-500 font-mono">{inputInSgd ? 'S$' : currencySymbol}</span>
                        <input
                          type="number"
                          placeholder="0.00"
                          step="0.01"
                          min="0"
                          value={splitDetails[friend.id] || ''}
                          onChange={(e) => handleDetailChange(friend.id, e.target.value)}
                          className="w-20 text-right text-xs font-semibold py-1 px-2 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-white"
                        />
                      </div>
                    )}

                    {/* Render percentage input */}
                    {splitType === 'percentage' && isSelected && (
                      <div className="flex items-center space-x-1.5 max-w-[125px]">
                        <input
                          type="number"
                          placeholder="0"
                          min="0"
                          max="100"
                          value={splitDetails[friend.id] || ''}
                          onChange={(e) => handleDetailChange(friend.id, e.target.value)}
                          className="w-16 text-right text-xs font-semibold py-1 px-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-white"
                        />
                        <span className="text-xs text-slate-500 font-mono">%</span>
                        {parsedAmount > 0 && (
                          <span className="text-[10px] text-slate-400 font-mono min-w-[45px] text-right">
                            ({inputInSgd ? 'S$' : currencySymbol}{(((parseFloat(splitDetails[friend.id]) || 0) / 100) * parsedAmount).toFixed(1)})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </form>

      {/* Footer State Warnings and Buttons */}
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex flex-col space-y-2">
        {/* Error warning notification */}
        {message && (
          <div className="flex items-start space-x-2 text-rose-600 bg-rose-50 border border-rose-100 p-2.5 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-snug">{message}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            {expenseToEdit && onDelete && (
              <button
                type="button"
                onClick={() => {
                  onDelete(expenseToEdit.id);
                }}
                className="flex items-center space-x-1.5 px-3 py-2 border border-rose-200 hover:bg-rose-50 hover:text-rose-700 text-rose-600 text-xs font-semibold rounded-xl transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 hover:bg-slate-150 text-slate-500 hover:text-slate-700 text-xs font-semibold rounded-xl transition-all"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!isValid}
              className={`flex items-center space-x-1.5 h-10 px-5 rounded-xl font-semibold text-xs tracking-wide shadow-sm transition-all ${
                isValid
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer active:scale-[0.98]'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
              type="button"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>{expenseToEdit ? 'Save Changes' : 'Record Bill'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
