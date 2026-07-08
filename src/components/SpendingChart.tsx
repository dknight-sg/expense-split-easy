/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { Expense } from '../types';

interface SpendingChartProps {
  expenses: Expense[];
  currencySymbol: string;
}

const CustomTooltip = ({ active, payload, currencySymbol }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-900 text-white p-3.5 rounded-xl border border-slate-850 shadow-xl text-xs font-sans">
        <p className="font-bold text-slate-400 mb-1.5">{data.fullDate}</p>
        <div className="space-y-1.5 leading-none">
          <div className="flex items-center justify-between gap-6">
            <span className="text-slate-400 text-[11px] font-medium">Daily Spend:</span>
            <span className="font-mono font-bold text-indigo-300">
              {currencySymbol}{data["Daily spend"].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between gap-6 border-t border-slate-800/80 pt-1.5 mt-0.5">
            <span className="text-slate-350 text-[11px] font-semibold">Cumulative Total:</span>
            <span className="font-mono font-black text-amber-400">
              {currencySymbol}{data["Total spent"].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

export default function SpendingChart({ expenses, currencySymbol }: SpendingChartProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Group by date and sort chronologically
  const chartData = useMemo(() => {
    const realExpenses = expenses.filter(e => !e.isSettlement);
    if (realExpenses.length === 0) return [];

    // Group by YYYY-MM-DD
    const dateMap: Record<string, number> = {};
    realExpenses.forEach(e => {
      dateMap[e.date] = (dateMap[e.date] || 0) + e.amount;
    });

    // Sort dates ascending
    const sortedDates = Object.keys(dateMap).sort((a, b) => {
      return new Date(a).getTime() - new Date(b).getTime();
    });

    let runningTotal = 0;
    return sortedDates.map(dateStr => {
      const dailyVal = dateMap[dateStr];
      runningTotal += dailyVal;

      // Format date for visual x-axis (e.g. "May 25")
      let axisLabel = dateStr;
      let fullDisplayDate = dateStr;
      try {
        const parsedDate = new Date(dateStr);
        if (!isNaN(parsedDate.getTime())) {
          axisLabel = parsedDate.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          });
          fullDisplayDate = parsedDate.toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
        }
      } catch (err) {
        // use fallback string
      }

      return {
        dateStr,
        fullDate: fullDisplayDate,
        date: axisLabel,
        "Daily spend": Number(dailyVal.toFixed(2)),
        "Total spent": Number(runningTotal.toFixed(2)),
      };
    });
  }, [expenses]);

  if (chartData.length === 0) {
    return null;
  }

  // Get total max for y-axis scaling logic
  const maxTotal = Math.max(...chartData.map(d => d["Total spent"]));

  return (
    <div className="bg-white border border-slate-150 rounded-2xl p-4.5 shadow-3xs select-none">
      {/* Header with quick collapsible trigger */}
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
              <span>Spending over time</span>
              <Sparkles className="w-3 h-3 text-indigo-500 fill-indigo-150" />
            </h4>
            {!isCollapsed && (
              <p className="text-[10px] text-slate-400 font-medium">
                Tracking cumulative trip expenses chronologically
              </p>
            )}
          </div>
        </div>
        
        <button className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
          {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* Collapsible Chart Segment */}
      {!isCollapsed && (
        <div className="mt-4 animate-fade-in">
          <div className="h-44 w-full text-[10px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.005}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="date" 
                  tickLine={false}
                  axisLine={false}
                  stroke="#94a3b8"
                  fontWeight={600}
                />
                <YAxis 
                  tickLine={false}
                  axisLine={false}
                  stroke="#94a3b8"
                  fontWeight={600}
                  tickFormatter={(val) => `${currencySymbol}${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                />
                <Tooltip 
                  content={<CustomTooltip currencySymbol={currencySymbol} />} 
                  cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="Total spent" 
                  stroke="#6366f1" 
                  strokeWidth={2.5}
                  fillOpacity={1} 
                  fill="url(#colorTotal)" 
                  activeDot={{ r: 5, strokeWidth: 0, fill: '#6366f1' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Quick Mini Stats Info Panel */}
          <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-semibold font-sans">
            <div className="flex items-center space-x-1.5">
              <span className="text-slate-400">First recorded:</span>
              <span className="text-slate-750 font-mono bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{chartData[0]?.date}</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="text-slate-400">Total accumulated:</span>
              <span className="text-indigo-600 font-mono bg-indigo-50/50 px-1.5 py-0.5 rounded border border-indigo-100/30">
                {currencySymbol}{maxTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
