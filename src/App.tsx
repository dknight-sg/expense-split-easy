/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Plus, ArrowLeft, Users, Calendar, Trash2, Share2, Copy, 
  Check, Search, Receipt, Coins, TrendingUp, UserPlus,
  ArrowRight, CornerDownRight, CheckCircle, Landmark,
  Wallet, HelpCircle, X, ChevronRight, MessageSquare, ListFilter,
  DollarSign, AlertTriangle, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Group, Friend, Expense, SplitType } from './types';
import {
  CURRENCIES, calculateGroupTotal,
  calculateBalances, calculateSettlements, generateShareableSummary,
  formatCurrency, CATEGORIES, generateSyncCode, getDefaultExchangeRate,
  getConvertedExpenses, fetchExchangeRate
} from './utils';
import ExpenseForm, { getCategoryIcon } from './components/ExpenseForm';
import SpendingChart from './components/SpendingChart';

// Firebase integrations
import { db } from './firebase';
import {
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  deleteDoc
} from 'firebase/firestore';


export default function App() {
  // State for trips/groups
  const [groups, setGroups] = useState<Group[]>(() => {
    const saved = localStorage.getItem('splitwise_groups');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved groups', e);
      }
    }
    return [];
  });

  const [activeGroupId, setActiveGroupId] = useState<string | null>(() => {
    const savedActive = localStorage.getItem('splitwise_active_group_id');
    if (savedActive) return savedActive;
    return groups[0]?.id || null;
  });

  // UI state controllers
  const [activeTab, setActiveTab] = useState<'expenses' | 'settle' | 'members'>('expenses');
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseToEdit, setExpenseToEdit] = useState<Expense | null>(null);
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  
  // Create New Group State
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupCurrency, setNewGroupCurrency] = useState('S$');
  const [newGroupFriends, setNewGroupFriends] = useState<string[]>(['weiren']);
  const [friendInput, setFriendInput] = useState('');

  // Expenses Search/Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterPayer, setFilterPayer] = useState<string>('all');

  // Copy success toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // SGD view mode and exchange rate states
  const [viewInSgd, setViewInSgd] = useState<boolean>(false);
  const [tempExchangeRate, setTempExchangeRate] = useState<string | null>(null);

  // Reset temporary exchange rate cache and SGD viewing mode when switching groups
  useEffect(() => {
    setTempExchangeRate(null);
    setViewInSgd(false);
  }, [activeGroupId]);

  // Custom delete confirmation modal state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'group' | 'settlement' | 'expense';
    id: string;
    title: string;
    desc: string;
    warning?: string;
    overrideLabel?: string;
  } | null>(null);

  // Firebase Real-time Synchronization States
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFetchingSgdRate, setIsFetchingSgdRate] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [joinedGroupIds, setJoinedGroupIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('splitwise_joined_group_ids');
    return saved ? JSON.parse(saved) : [];
  });

  // Core join logic shared by the manual code-entry modal and the auto-join-via-link flow
  const joinTripByCode = async (rawCode: string): Promise<boolean> => {
    const cleanCode = rawCode.trim().toUpperCase();
    if (!cleanCode) {
      showToast("Please enter a valid 6-digit sync code.");
      return false;
    }

    setIsSyncing(true);
    try {
      // Lookup the code securely via document ID read (fully allowed by rules without general listing)
      const codeRef = doc(db, 'syncCodes', cleanCode);
      const codeSnap = await getDoc(codeRef);

      if (!codeSnap.exists()) {
        showToast("Trip not found! Check your code/link and try again.");
        return false;
      }

      const { groupId } = codeSnap.data() as { groupId: string };
      const groupRef = doc(db, 'groups', groupId);
      const groupSnap = await getDoc(groupRef);

      if (!groupSnap.exists()) {
        showToast("Trip group is no longer available.");
        return false;
      }

      const remoteGroup = groupSnap.data() as Group;

      // Store custom record of joined group-ids locally so we can track and listen to it
      const savedJoined = localStorage.getItem('splitwise_joined_group_ids');
      const joinedList: string[] = savedJoined ? JSON.parse(savedJoined) : [];
      if (!joinedList.includes(remoteGroup.id)) {
        joinedList.push(remoteGroup.id);
        localStorage.setItem('splitwise_joined_group_ids', JSON.stringify(joinedList));
      }
      setJoinedGroupIds(joinedList);

      setGroups(prev => {
        if (prev.some(g => g.id === remoteGroup.id)) {
          return prev.map(g => g.id === remoteGroup.id ? remoteGroup : g);
        }
        return [remoteGroup, ...prev];
      });

      setActiveGroupId(remoteGroup.id);
      showToast(`Successfully joined trip: "${remoteGroup.name}"!`);
      return true;
    } catch (err) {
      console.error("Failed to lookup sync code:", err);
      showToast("Unable to search code. Please try again.");
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-join a trip when the app is opened via a shared invite link (?join=CODE)
  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get('join');
    if (!inviteCode) return;

    joinTripByCode(inviteCode).finally(() => {
      // Strip the param so a refresh doesn't re-trigger the join lookup
      const url = new URL(window.location.href);
      url.searchParams.delete('join');
      window.history.replaceState({}, '', url.toString());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Generate a code for current active group to share (works for guests too, not just signed-in owners)
  const handleGenerateActiveSyncCode = async (): Promise<string | null> => {
    if (!currentGroup) return null;
    setIsSyncing(true);
    try {
      const code = generateSyncCode();
      const updatedGroups = groups.map(g => {
        if (g.id === currentGroup.id) {
          return {
            ...g,
            syncCode: code,
            updatedAt: new Date().toISOString()
          };
        }
        return g;
      });
      setGroups(updatedGroups);

      // Save directly to Firestore immediately so the code/link is live right away
      const groupRef = doc(db, 'groups', currentGroup.id);
      await setDoc(groupRef, sanitizeForFirestore({
        ...currentGroup,
        syncCode: code,
        ownerId: currentGroup.ownerId || 'guest',
        updatedAt: new Date().toISOString()
      }));

      // Also write to syncCodes mapping
      const codeRef = doc(db, 'syncCodes', code);
      await setDoc(codeRef, {
        groupId: currentGroup.id,
        createdAt: new Date().toISOString()
      });

      return code;
    } catch (err) {
      console.error(err);
      return null;
    } finally {
      setIsSyncing(false);
    }
  };

  // Build a shareable invite link for the given sync code
  const buildInviteLink = (code: string): string =>
    `${window.location.origin}${window.location.pathname}?join=${code}`;

  // One-tap invite: ensures a sync code exists, then opens the Invite panel with
  // direct WhatsApp/Telegram buttons plus a copyable link (and the native share
  // sheet on devices that support it).
  const handleShareInvite = async () => {
    if (!currentGroup) return;
    const code = currentGroup.syncCode || await handleGenerateActiveSyncCode();
    if (!code) {
      showToast("Couldn't create an invite link. Please try again.");
      return;
    }
    setInviteLink(buildInviteLink(code));
    setShowInviteModal(true);
  };

  // Native OS share sheet (shows WhatsApp/Telegram/Slack/etc. if installed) — mobile only
  const handleNativeShare = async () => {
    if (!currentGroup || !inviteLink) return;
    try {
      await navigator.share({
        title: `Join ${currentGroup.name} on SplitEasy`,
        text: `Join our trip "${currentGroup.name}" on SplitEasy to track shared expenses:`,
        url: inviteLink,
      });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.error('Failed to share invite:', err);
      }
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      showToast('Invite link copied to clipboard! 📋');
    } catch (err) {
      console.error('Failed to copy invite link:', err);
      showToast('Failed to copy link. Please try again.');
    }
  };

  const handleShareToWhatsApp = () => {
    if (!currentGroup || !inviteLink) return;
    const text = `Join our trip "${currentGroup.name}" on SplitEasy to track shared expenses: ${inviteLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const handleShareToTelegram = () => {
    if (!currentGroup || !inviteLink) return;
    const text = `Join our trip "${currentGroup.name}" on SplitEasy to track shared expenses`;
    window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };


  // Helper to remove any undefined fields before saving to Firestore
  const sanitizeForFirestore = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeForFirestore(item));
    } else if (typeof obj === 'object' && obj !== null) {
      const clean: any = {};
      Object.keys(obj).forEach(key => {
        if (obj[key] !== undefined) {
          clean[key] = sanitizeForFirestore(obj[key]);
        }
      });
      return clean;
    }
    return obj;
  };

  // Centralized function to update group locally and immediately sync with cloud
  const saveGroupLocallyAndSync = async (updatedGroup: Group, overrideGroups?: Group[]) => {
    // Add ownerId if missing so that standard owner/member fields can be verified layout-wise
    const withOwnership: Group = {
      ...updatedGroup,
      ownerId: updatedGroup.ownerId || 'guest',
      updatedAt: updatedGroup.updatedAt || new Date().toISOString()
    };

    const nextGroups = (overrideGroups || groups).map(g => g.id === withOwnership.id ? withOwnership : g);
    // If we're overriding and the updated group is not in the array yet, insert it at the beginning
    if (overrideGroups && !overrideGroups.some(g => g.id === withOwnership.id)) {
      nextGroups.unshift(withOwnership);
    }

    setGroups(nextGroups);
    localStorage.setItem('splitwise_groups', JSON.stringify(nextGroups));

    // Sync cloud storage instantly (allowing non-logged-in guests to sync smoothly too!)
    const groupRef = doc(db, 'groups', withOwnership.id);
    const cleanData = sanitizeForFirestore(withOwnership);
    try {
      await setDoc(groupRef, cleanData);
      localStorage.setItem(`sync_cache_${withOwnership.id}`, JSON.stringify(cleanData));
      
      // Ensure syncCode is registered in syncCodes table if active
      if (withOwnership.syncCode) {
        const codeRef = doc(db, 'syncCodes', withOwnership.syncCode.toUpperCase());
        await setDoc(codeRef, {
          groupId: withOwnership.id,
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(`Failed to push group ${withOwnership.id} to Firestore`, err);
    }
  };

  // Sync groups to LocalStorage
  useEffect(() => {
    localStorage.setItem('splitwise_groups', JSON.stringify(groups));
  }, [groups]);

  // Firestore publisher loop: Upload local modifications to cloud in real-time
  useEffect(() => {
    groups.forEach(async (group) => {
      const groupRef = doc(db, 'groups', group.id);
      const groupToSave = {
        ...group,
        ownerId: (group as any).ownerId || 'guest',
        updatedAt: (group as any).updatedAt || new Date().toISOString()
      };

      const cleanData = sanitizeForFirestore(groupToSave);
      const groupStr = JSON.stringify(cleanData);
      const currentCache = localStorage.getItem(`sync_cache_${group.id}`);

      if (currentCache !== groupStr) {
        try {
          await setDoc(groupRef, cleanData);
          localStorage.setItem(`sync_cache_${group.id}`, groupStr);

          // Heal/auto-register sync code on Firestore if it has one
          if (group.syncCode) {
            const codeRef = doc(db, 'syncCodes', group.syncCode.toUpperCase());
            await setDoc(codeRef, {
              groupId: group.id,
              createdAt: new Date().toISOString()
            });
          }
        } catch (err) {
          console.error(`Failed to push group ${group.id} to Firestore`, err);
        }
      }
    });
  }, [groups]);

  // Firestore subscriber loop: Real-time sync down from Firestore (handles guests and hard-deletes!)
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];
    const activeGroupIds = groups.map(g => g.id);

    // Subscribe to each local group in real-time
    groups.forEach((group) => {
      const unsub = onSnapshot(doc(db, 'groups', group.id), (docSnap) => {
        if (!docSnap.exists()) {
          // Group has been deleted on Firestore (hard delete) by owner!
          // Filter it out locally so it doesn't reappear on refresh or stay in state
          setGroups(prevGroups => {
            const updated = prevGroups.filter(g => g.id !== group.id);
            localStorage.setItem('splitwise_groups', JSON.stringify(updated));
            return updated;
          });
          localStorage.removeItem(`sync_cache_${group.id}`);
          
          const savedJoined = localStorage.getItem('splitwise_joined_group_ids');
          const joinedList: string[] = savedJoined ? JSON.parse(savedJoined) : [];
          if (joinedList.includes(group.id)) {
            const nextJoined = joinedList.filter(id => id !== group.id);
            localStorage.setItem('splitwise_joined_group_ids', JSON.stringify(nextJoined));
            setJoinedGroupIds(nextJoined);
          }
          return;
        }

        const dbG = docSnap.data() as Group;

        setGroups(prevGroups => {
          const prevMap = new Map(prevGroups.map(g => [g.id, g]));
          const localG = prevMap.get(dbG.id);
          const dbStr = JSON.stringify(dbG);

          if (!localG) {
            localStorage.setItem(`sync_cache_${dbG.id}`, dbStr);
            return [dbG, ...prevGroups];
          } else {
            const gVal = localG as Group;
            const isDifferent = 
              dbG.updatedAt !== gVal.updatedAt ||
              dbG.expenses?.length !== gVal.expenses?.length ||
              dbG.friends?.length !== gVal.friends?.length ||
              dbG.name !== gVal.name ||
              dbG.description !== gVal.description ||
              JSON.stringify(dbG.expenses) !== JSON.stringify(gVal.expenses);

            if (isDifferent) {
              localStorage.setItem(`sync_cache_${dbG.id}`, dbStr);
              return prevGroups.map(g => g.id === dbG.id ? dbG : g);
            }
          }
          return prevGroups;
        });
      }, (error) => {
        console.warn(`Denied/Unavailable real-time sync for group ${group.id}:`, error);
      });
      unsubscribes.push(unsub);
    });

    // Also subscribe to other groups from joinedGroupIds state that may not be in local groups yet
    joinedGroupIds.forEach((joinedId) => {
      if (activeGroupIds.includes(joinedId)) return; // Already subscribed

      const unsub = onSnapshot(doc(db, 'groups', joinedId), (docSnap) => {
        if (!docSnap.exists()) {
          // Group was deleted on Firestore
          setGroups(prevGroups => {
            const updated = prevGroups.filter(g => g.id !== joinedId);
            localStorage.setItem('splitwise_groups', JSON.stringify(updated));
            return updated;
          });
          localStorage.removeItem(`sync_cache_${joinedId}`);
          
          const savedJoined = localStorage.getItem('splitwise_joined_group_ids');
          const joinedList: string[] = savedJoined ? JSON.parse(savedJoined) : [];
          if (joinedList.includes(joinedId)) {
            const nextJoined = joinedList.filter(id => id !== joinedId);
            localStorage.setItem('splitwise_joined_group_ids', JSON.stringify(nextJoined));
            setJoinedGroupIds(nextJoined);
          }
          return;
        }

        const dbG = docSnap.data() as Group;

        setGroups(prevGroups => {
          const prevMap = new Map(prevGroups.map(g => [g.id, g]));
          const localG = prevMap.get(dbG.id);
          const dbStr = JSON.stringify(dbG);

          if (!localG) {
            localStorage.setItem(`sync_cache_${dbG.id}`, dbStr);
            return [dbG, ...prevGroups];
          } else {
            const gVal = localG as Group;
            const isDifferent = 
              dbG.updatedAt !== gVal.updatedAt ||
              dbG.expenses?.length !== gVal.expenses?.length ||
              dbG.friends?.length !== gVal.friends?.length ||
              dbG.name !== gVal.name ||
              dbG.description !== gVal.description ||
              JSON.stringify(dbG.expenses) !== JSON.stringify(gVal.expenses);

            if (isDifferent) {
              localStorage.setItem(`sync_cache_${dbG.id}`, dbStr);
              return prevGroups.map(g => g.id === dbG.id ? dbG : g);
            }
          }
          return prevGroups;
        });
      }, (error) => {
        console.warn(`Access denied/unable to sync joined group ${joinedId}:`, error);
      });
      unsubscribes.push(unsub);
    });

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [groups.map(g => g.id).join(','), joinedGroupIds.join(',')]);

  // Sync active group selection
  useEffect(() => {
    if (activeGroupId) {
      localStorage.setItem('splitwise_active_group_id', activeGroupId);
    } else {
      localStorage.removeItem('splitwise_active_group_id');
    }
  }, [activeGroupId]);

  // Helper for quick toast alert
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };


  // Safe fetch of current group
  const currentGroup = groups.find(g => g.id === activeGroupId) || null;
  const groupCurrencyCode = currentGroup ? (CURRENCIES.find(c => c.symbol === currentGroup.currency)?.code || currentGroup.currency) : '';
  const sgdExchangeRate = currentGroup ? (currentGroup.sgdExchangeRate || getDefaultExchangeRate(currentGroup.currency)) : 1.34;
  const displayExpenses = currentGroup
    ? getConvertedExpenses(currentGroup.expenses, viewInSgd ? sgdExchangeRate : 1.0)
    : [];

  // Auto-fetch a live SGD exchange rate the first time a trip is opened, instead of
  // relying on the rough hardcoded approximation table (which can be quite stale/wrong)
  useEffect(() => {
    if (!currentGroup || currentGroup.sgdExchangeRate || groupCurrencyCode === 'SGD') return;
    let cancelled = false;
    setIsFetchingSgdRate(true);
    fetchExchangeRate(groupCurrencyCode, 'SGD').then(liveRate => {
      if (!cancelled && liveRate) {
        saveGroupLocallyAndSync({ ...currentGroup, sgdExchangeRate: liveRate });
      }
    }).finally(() => {
      if (!cancelled) setIsFetchingSgdRate(false);
    });
    return () => { cancelled = true; };
  }, [currentGroup?.id, currentGroup?.sgdExchangeRate, groupCurrencyCode]);

  // Add a friend to the newly forming group
  const handleAddFriendToNewGroup = () => {
    const clean = friendInput.trim();
    if (clean) {
      if (newGroupFriends.some(f => f.toLowerCase() === clean.toLowerCase())) {
        showToast('Friend already added to list!');
        return;
      }
      setNewGroupFriends([...newGroupFriends, clean]);
      setFriendInput('');
    }
  };

  // Remove friend from forming group
  const handleRemoveFriendFromNewGroup = (index: number) => {
    if (newGroupFriends.length > 1) {
      setNewGroupFriends(newGroupFriends.filter((_, i) => i !== index));
    } else {
      showToast('Need at least 1 group member.');
    }
  };

  // Save the new group
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) {
      showToast('Please enter a group or trip name!');
      return;
    }

    const uniqueFriends: Friend[] = newGroupFriends.map((name, i) => ({
      id: `friend-${Date.now()}-${i}`,
      name: name.trim()
    }));

    const newGroup: Group = {
      id: `group-${Date.now()}`,
      name: newGroupName.trim(),
      description: newGroupDesc.trim() || undefined,
      friends: uniqueFriends,
      expenses: [],
      currency: newGroupCurrency,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Use our centralized sync function to write it instantly
    await saveGroupLocallyAndSync(newGroup, [newGroup, ...groups]);
    setActiveGroupId(newGroup.id);
    setShowAddGroupModal(false);
    
    // Reset state fields
    setNewGroupName('');
    setNewGroupDesc('');
    setNewGroupCurrency('$');
    setNewGroupFriends(['weiren']);
    setActiveTab('expenses');
    showToast(`Created trip: ${newGroup.name}!`);
  };

  // Add friend to CURRENT active group
  const [newFriendNameActive, setNewFriendNameActive] = useState('');
  const handleAddFriendToActiveGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentGroup) return;
    const clean = newFriendNameActive.trim();
    if (!clean) return;

    if (currentGroup.friends.some(f => f.name.toLowerCase() === clean.toLowerCase())) {
      showToast(`${clean} is already in the group!`);
      return;
    }

    const newFriend: Friend = {
      id: `friend-${Date.now()}`,
      name: clean
    };

    let nextGroup: Group | null = null;
    const updatedGroups = groups.map(g => {
      if (g.id === currentGroup.id) {
        nextGroup = {
          ...g,
          friends: [...g.friends, newFriend],
          updatedAt: new Date().toISOString()
        };
        return nextGroup;
      }
      return g;
    });

    if (nextGroup) {
      saveGroupLocallyAndSync(nextGroup, updatedGroups);
    }
    setNewFriendNameActive('');
    showToast(`Added ${clean} to the group!`);
  };

  // Remove friend from ACTIVE group, ONLY if they have zero transactions associated
  const handleRemoveFriendFromActiveGroup = (friendId: string) => {
    if (!currentGroup) return;
    
    // Check if involved in any expense (is payer or receiver)
    const isPayer = currentGroup.expenses.some(e => e.paidBy === friendId);
    const isParticipant = currentGroup.expenses.some(e => e.splitAmong.includes(friendId));

    if (isPayer || isParticipant) {
      showToast('Cannot remove friend. They have recorded transactions associated with them!');
      return;
    }

    if (currentGroup.friends.length <= 1) {
      showToast('Need at least 1 person in the group!');
      return;
    }

    let nextGroup: Group | null = null;
    const updatedGroups = groups.map(g => {
      if (g.id === currentGroup.id) {
        nextGroup = {
          ...g,
          friends: g.friends.filter(f => f.id !== friendId),
          updatedAt: new Date().toISOString()
        };
        return nextGroup;
      }
      return g;
    });

    if (nextGroup) {
      saveGroupLocallyAndSync(nextGroup, updatedGroups);
    }
    showToast('Removed teammate.');
  };

  // Create or Update Expense
  const handleSaveExpense = (expenseData: Omit<Expense, 'id'> & { id?: string }) => {
    if (!currentGroup) return;

    let updatedExpenses = [...currentGroup.expenses];

    if (expenseData.id) {
      // Editing existing
      updatedExpenses = updatedExpenses.map(e => {
        if (e.id === expenseData.id) {
          return { ...e, ...expenseData } as Expense;
        }
        return e;
      });
      showToast('Updated transaction successfully!');
    } else {
      // Adding new
      const nextId = `expense-${Date.now()}`;
      const newExpense: Expense = {
        id: nextId,
        ...expenseData
      } as Expense;
      updatedExpenses = [newExpense, ...updatedExpenses];
      showToast('Recorded spending!');
    }

    let nextGroup: Group | null = null;
    const updatedGroups = groups.map(g => {
      if (g.id === currentGroup.id) {
        nextGroup = {
          ...g,
          expenses: updatedExpenses,
          updatedAt: new Date().toISOString()
        };
        return nextGroup;
      }
      return g;
    });

    if (nextGroup) {
      saveGroupLocallyAndSync(nextGroup, updatedGroups);
    }
    setShowExpenseForm(false);
    setExpenseToEdit(null);
  };

  // Delete Expense
  const handleDeleteExpense = (expenseId: string) => {
    if (!currentGroup) return;

    let nextGroup: Group | null = null;
    const updatedGroups = groups.map(g => {
      if (g.id === currentGroup.id) {
        nextGroup = {
          ...g,
          expenses: g.expenses.filter(e => e.id !== expenseId),
          updatedAt: new Date().toISOString()
        };
        return nextGroup;
      }
      return g;
    });

    if (nextGroup) {
      saveGroupLocallyAndSync(nextGroup, updatedGroups);
    }
    setShowExpenseForm(false);
    setExpenseToEdit(null);
    showToast('Deleted bill.');
  };

  // Reset/Delete Entire Group (Hard delete)
  const handleDeleteGroup = async (groupId: string) => {
    // Find Group info first before removing from state
    const targetGroup = groups.find(g => g.id === groupId);

    // Filter local groups first
    const remaining = groups.filter(g => g.id !== groupId);

    setGroups(remaining);
    setActiveGroupId(remaining[0]?.id || null);
    localStorage.setItem('splitwise_groups', JSON.stringify(remaining));

    // Clear local storage cache & references
    localStorage.removeItem(`sync_cache_${groupId}`);
    
    // Remove from joined list
    const savedJoined = localStorage.getItem('splitwise_joined_group_ids');
    let joinedList: string[] = savedJoined ? JSON.parse(savedJoined) : [];
    if (joinedList.includes(groupId)) {
      joinedList = joinedList.filter(id => id !== groupId);
      localStorage.setItem('splitwise_joined_group_ids', JSON.stringify(joinedList));
      setJoinedGroupIds(joinedList);
    }

    // Also hard-delete from the cloud
    if (targetGroup) {
      try {
        const groupRef = doc(db, 'groups', groupId);
        // Delete from Firestore
        await deleteDoc(groupRef);

        // Delete associated short sync code mapping
        if (targetGroup.syncCode) {
          const codeRef = doc(db, 'syncCodes', targetGroup.syncCode.toUpperCase());
          await deleteDoc(codeRef);
        }
        console.log("Firestore elements deleted permanently.");
      } catch (err) {
        console.warn("Soft-deleted on this device. Unable to hard-delete from cloud:", err);
      }
    }

    showToast('Permanently deleted trip!');
  };

  // Trigger custom delete modal for normal bills in ExpenseForm
  const handleExpenseDeleteTrigger = (expenseId: string) => {
    if (!currentGroup) return;
    const expense = currentGroup.expenses.find(e => e.id === expenseId);
    if (!expense) return;
    setDeleteConfirm({
      type: 'expense',
      id: expenseId,
      title: 'Delete Bill Record',
      desc: `Are you sure you want to delete the transaction "${expense.title}"? This cannot be undone and will recalculate balances for everyone.`,
      overrideLabel: 'Yes, Delete Bill'
    });
  };

  // Perform the actual deletion after confirmation dialog completes
  const handleConfirmDelete = () => {
    if (!deleteConfirm) return;
    const { type, id } = deleteConfirm;
    if (type === 'group') {
      handleDeleteGroup(id);
    } else {
      handleDeleteExpense(id);
    }
    setDeleteConfirm(null);
  };

  // Copy Settlement summary text to clipboard
  const handleCopySummary = () => {
    if (!currentGroup) return;
    const activeExpenses = viewInSgd ? displayExpenses : currentGroup.expenses;
    const activeCurrencySymbol = viewInSgd ? 'S$' : currentGroup.currency;
    const settlements = calculateSettlements(currentGroup.friends, activeExpenses);
    const text = generateShareableSummary(currentGroup.name, settlements, activeCurrencySymbol);
    
    navigator.clipboard.writeText(text).then(
      () => showToast('Copied WhatsApp text to clipboard! 📋'),
      () => showToast('Failed to copy. Please try again.')
    );
  };

  // Trigger quick settle up
  const handleQuickSettle = (transfer: any) => {
    if (!currentGroup) return;

    // Create a special direct settlement transaction
    const dateStr = new Date().toISOString().split('T')[0];
    const settlementExpense: Expense = {
      id: `expense-settled-${Date.now()}`,
      title: `Settled: ${transfer.fromName} paid ${transfer.toName}`,
      amount: transfer.amount,
      paidBy: transfer.fromId,
      splitAmong: [transfer.toId],
      splitType: 'equal',
      date: dateStr,
      category: 'Other',
      isSettlement: true
    };

    let nextGroup: Group | null = null;
    const updatedGroups = groups.map(g => {
      if (g.id === currentGroup.id) {
        nextGroup = {
          ...g,
          expenses: [settlementExpense, ...g.expenses],
          updatedAt: new Date().toISOString()
        };
        return nextGroup;
      }
      return g;
    });

    if (nextGroup) {
      saveGroupLocallyAndSync(nextGroup, updatedGroups);
    }
    showToast(`Recorded settlement of ${currentGroup.currency}${transfer.amount}!`);
  };

  // Completely wipe local storage and cache context for clean reset on mobile/desktop
  const handleHardReset = () => {
    if (window.confirm("Perform hard reset? This will wipe all locally stored trips and offline cached data on this device. Your synced cloud trips will remain active in the cloud, but you must reopen their invite link to load them.")) {
      localStorage.clear();
      localStorage.setItem('splitwise_demo_dismissed', 'true');
      window.location.reload();
    }
  };

  // Filter and search active transactions
  const filteredExpenses = currentGroup
    ? displayExpenses.filter(e => {
        const matchesSearch = e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (currentGroup.friends.find(f => f.id === e.paidBy)?.name || '').toLowerCase().includes(searchQuery.toLowerCase());
        
        const matchesCategory = filterCategory === 'all' || e.category === filterCategory;
        const matchesPayer = filterPayer === 'all' || e.paidBy === filterPayer;

        return matchesSearch && matchesCategory && matchesPayer;
      })
    : [];

  return (
    <div className="min-h-screen bg-slate-50/70 flex flex-col font-sans text-slate-800 antialiased select-none">
      
      {/* Dynamic Toast System */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            className="fixed top-5 left-1/2 -translate-x-1/2 z-[999] bg-slate-900 text-white font-medium text-xs py-2.5 px-4.5 rounded-xl shadow-lg flex items-center space-x-2 border border-slate-800"
          >
            <CheckCircle className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Application Header Bar */}
      <header className="bg-white border-b border-slate-200/80 h-16 shrink-0 z-30 sticky top-0 px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white text-base shadow-sm font-display">
            S
          </div>
          <div>
            <h1 className="text-base font-bold font-display tracking-tight text-slate-900 leading-tight">SplitEasy</h1>
            <p className="text-[10px] text-slate-450 font-semibold uppercase tracking-wider">simple app by yc</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          {groups.length > 0 && (
            <button
              onClick={() => setShowAddGroupModal(true)}
              className="flex items-center space-x-1 px-3.5 h-9 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Trip</span>
            </button>
          )}
        </div>
      </header>

      {/* Responsive Workspace Grid */}
      <div className="flex-1 w-full max-w-7xl mx-auto px-0 sm:px-4 md:px-6 py-0 sm:py-4 md:py-6 flex flex-col justify-start">
        {groups.length === 0 ? (
          /* =========================================================================
             1. REFINED GROUPS EMPTY FALLBACK UI
             ========================================================================= */
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto my-12">
            <div className="p-4 bg-indigo-50/50 rounded-full text-indigo-600 mb-4 ring-8 ring-indigo-50/20">
              <Landmark className="w-10 h-10" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 font-display">No Trips Active</h2>
            <p className="text-sm text-slate-500 mt-2 max-w-xs mx-auto">
              Create a trip to start splitting expenses with friends.
            </p>
            <div className="mt-6 space-y-3 w-full max-w-xs">
              <button
                onClick={() => setShowAddGroupModal(true)}
                className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs tracking-wider transition-all shadow-sm cursor-pointer"
              >
                Create New Trip
              </button>
            </div>
          </div>
        ) : (
          /* Multi-column layout dashboard */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start flex-1 w-full">
            
            {/* 1. LEFT SIDEBAR PANEL: All Groups Listing (always visible, or toggled on mobile) */}
            <aside className={`lg:col-span-4 bg-white border-t sm:border border-slate-200/80 sm:rounded-2xl flex flex-col justify-between overflow-hidden h-[calc(100vh-64px)] lg:h-[700px] shadow-xs shrink-0 ${
              activeGroupId ? 'hidden lg:flex' : 'flex'
            }`}>
              
              <div className="flex flex-col flex-1 overflow-hidden">
                {/* Header widget */}
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                  <span className="text-xs font-bold text-slate-450 uppercase tracking-widest">Active Travel Trips ({groups.length})</span>
                  <button
                    onClick={() => setShowAddGroupModal(true)}
                    className="flex lg:hidden items-center space-x-1 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[10px] font-bold border border-indigo-100/50 transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create</span>
                  </button>
                </div>

                {/* Group Scroll Box */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {groups.map(group => {
                    const isSelected = group.id === activeGroupId;
                    const totalSpent = calculateGroupTotal(group.expenses);
                    const settlements = calculateSettlements(group.friends, group.expenses);

                    return (
                      <div
                        key={group.id}
                        onClick={() => {
                          setActiveGroupId(group.id);
                          setActiveTab('expenses');
                        }}
                        className={`p-3.5 border transition-all rounded-xl cursor-pointer flex items-center justify-between group ${
                          isSelected
                            ? 'bg-indigo-50/30 border-indigo-250 shadow-2xs'
                            : 'bg-white border-slate-150 hover:border-slate-300 hover:bg-slate-50/10'
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-3.5">
                          <div className="flex items-center space-x-1.5 flex-wrap">
                            <h4 className={`font-semibold text-xs font-display truncate transition-colors leading-snug ${
                              isSelected ? 'text-indigo-950 group-hover:text-indigo-900' : 'text-slate-800'
                            }`}>
                              {group.name}
                            </h4>
                            <span className="text-[9px] bg-slate-100 text-slate-500 py-0.5 px-1 rounded-md font-mono">
                              {group.currency}
                            </span>
                            {group.syncCode && (
                              <span className="text-[9px] bg-teal-50 border border-teal-100/30 text-teal-600 font-bold py-0.5 px-1.5 rounded-md font-mono">
                                Code: {group.syncCode}
                              </span>
                            )}
                          </div>
                          {group.description && (
                            <p className="text-[11px] text-slate-450 truncate mt-0.5">{group.description}</p>
                          )}
                          <div className="flex items-center space-x-2 text-[10px] text-slate-400 mt-2">
                            <span className="flex items-center">
                              <Users className="w-3.5 h-3.5 mr-0.5" />
                              {group.friends.length} teammates
                            </span>
                            <span>•</span>
                            <span>{group.expenses.length} bills</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-[9px] text-slate-450 font-bold uppercase tracking-wider">Total Spent</p>
                          <p className="text-xs font-bold text-slate-800 font-mono mt-0.5">
                            {formatCurrency(totalSpent, group.currency)}
                          </p>
                          {settlements.length > 0 ? (
                            <span className="inline-block mt-1 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-100/50 px-1.5 py-0.2 rounded">
                              {settlements.length} active owes
                            </span>
                          ) : (
                            <span className="inline-block mt-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100/50 px-1.5 py-0.2 rounded">
                              Settled Up
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sidebar bottom guide */}
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col items-center justify-center space-y-1 text-center text-[10px] text-slate-400 font-mono">
                <div>Safe local persistence storage enabled</div>
                <button
                  onClick={handleHardReset}
                  className="text-red-500 hover:text-red-700 hover:underline font-semibold cursor-pointer transition-all bg-transparent border-none p-0"
                >
                  Clear Device Cache &amp; Reset
                </button>
              </div>

            </aside>

            {/* 2. RIGHT DETAILED WORKSPACE CANVAS */}
            <main className={`lg:col-span-8 bg-white border-t sm:border border-slate-200/80 sm:rounded-2xl overflow-hidden h-[calc(100vh-64px)] lg:h-[700px] flex flex-col relative shadow-xs ${
              !activeGroupId 
                ? 'hidden lg:flex justify-center items-center text-center p-8 bg-slate-50/20 border-dashed border-slate-300' 
                : 'flex'
            }`}>
              
              {!currentGroup ? (
                /* Static right-hand pane placeholder if zero group is loaded */
                <div className="text-center p-8 text-slate-400 flex flex-col items-center justify-center h-full">
                  <Wallet className="w-12 h-12 text-slate-350 stroke-[1.5] mb-2.5" />
                  <h3 className="text-sm font-bold text-slate-700 font-display">No active group</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs">
                    Please use the sidebar menu or header control to load demo data or create a new group.
                  </p>
                </div>
              ) : (
                /* Clean active group workflow render panels */
                <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/30">
                  
                  {/* Top nav of detail panel */}
                  <div className="px-5 py-3 bg-white border-b border-slate-100 flex items-center justify-between shrink-0">
                    <button
                      onClick={() => setActiveGroupId(null)}
                      className="lg:hidden flex items-center space-x-1 px-2 py-1 bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-600 font-semibold text-xs transition-all border border-slate-200/50"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>

                    <div className="text-left flex-1 mx-2 min-w-0 flex items-center space-x-2.5">
                      <div className="truncate">
                        <h2 className="font-bold text-slate-800 text-sm font-display truncate">
                          {currentGroup.name}
                        </h2>
                        {currentGroup.description && (
                          <p className="text-[10px] text-slate-400 truncate">{currentGroup.description}</p>
                        )}
                      </div>
                      
                      {/* One-tap Invite Link sharing */}
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleShareInvite();
                          }}
                          disabled={isSyncing}
                          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-[10px] px-2 py-0.5 rounded-lg flex items-center space-x-1 transition-all cursor-pointer"
                          title="Share a one-tap invite link via WhatsApp, Telegram, Slack, etc."
                        >
                          {isSyncing ? (
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Share2 className="w-2.5 h-2.5" />
                          )}
                          <span>Invite</span>
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        const settlements = calculateSettlements(currentGroup.friends, currentGroup.expenses);
                        const hasUnsettled = settlements.length > 0;
                        setDeleteConfirm({
                          type: 'group',
                          id: currentGroup.id,
                          title: 'Delete Trip & Group',
                          desc: `Are you sure you want to permanently delete the trip group "${currentGroup.name}"? This action cannot be undone and will permanently erase all members, bills, and logs in this trip.`,
                          warning: hasUnsettled 
                            ? `Warning: There are active debts under "${currentGroup.name}" that have not been fully settled yet. If you delete this trip, unpaid balances will be lost.`
                            : undefined,
                          overrideLabel: hasUnsettled ? 'Delete Anyway' : 'Yes, Delete Trip'
                        });
                      }}
                      title="Remove this group"
                      className="p-1 px-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                   {/* Aesthetic Premium Summary Row (Instead of heavy black strip) */}
                  <div className="bg-white px-5 py-4 border-b border-slate-150 shrink-0 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-widest text-[#64748b]">
                        Trip Total Spend {viewInSgd && '(Converted to SGD)'}
                      </p>
                      <h3 className="text-2xl font-black font-mono tracking-tight text-slate-900 mt-1">
                        {formatCurrency(
                          calculateGroupTotal(displayExpenses), 
                          viewInSgd ? 'S$' : currentGroup.currency
                        )}
                      </h3>
                    </div>
                    
                    <button
                      onClick={() => {
                        setShowExpenseForm(true);
                        setExpenseToEdit(null);
                      }}
                      className="bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] transition-all px-4 py-2 rounded-xl text-xs font-bold tracking-wide text-white flex items-center space-x-1"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Record spending</span>
                    </button>
                  </div>

                  {/* SGD Flexible Currency Switcher Action Tool Card */}
                  {currentGroup.currency !== 'S$' && (
                    <div className="bg-indigo-50/40 px-5 py-2.5 border-b border-indigo-100 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0 select-none">
                      <div className="flex flex-wrap items-center gap-1.5 text-slate-600">
                        <span className="font-semibold text-slate-500">Exchange Rate:</span>
                        {isFetchingSgdRate && <RefreshCw className="w-3 h-3 text-indigo-400 animate-spin" />}
                        <div className="flex items-center space-x-1 bg-white border border-slate-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 rounded-lg px-2 py-0.5">
                          <span className="font-bold text-slate-500">1 {currentGroup.currency} =</span>
                          <input
                            type="number"
                            step="0.0001"
                            min="0.0001"
                            value={tempExchangeRate ?? sgdExchangeRate}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setTempExchangeRate(e.target.value);
                              if (val > 0) {
                                const updated = {
                                  ...currentGroup,
                                  sgdExchangeRate: val,
                                  updatedAt: new Date().toISOString()
                                };
                                saveGroupLocallyAndSync(updated);
                              }
                            }}
                            className="w-14 text-center font-bold text-slate-800 font-mono focus:outline-none p-0 text-xs inline bg-transparent"
                          />
                          <span className="text-[10px] text-slate-400 font-bold font-mono">SGD</span>
                        </div>
                        <span className="text-[10px] text-slate-450 italic hidden sm:inline">(changes sync with group devices)</span>
                      </div>

                      <div className="flex items-center bg-slate-100/80 p-0.5 border border-slate-200/40 rounded-xl font-bold">
                        <button
                          type="button"
                          onClick={() => setViewInSgd(false)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            !viewInSgd
                              ? 'bg-white text-slate-800 shadow-3xs border border-slate-200/30'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          {groupCurrencyCode} Base ({currentGroup.currency})
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewInSgd(true)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            viewInSgd
                              ? 'bg-indigo-600 text-white shadow-2xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          Convert to SGD S$
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Clean Tab Selector */}
                  <div className="bg-white border-b border-slate-205 shrink-0 flex select-none">
                    <button
                      onClick={() => setActiveTab('expenses')}
                      className={`flex-1 py-3 text-xs font-bold text-center border-b-2 transition-all flex items-center justify-center space-x-1.5 ${
                        activeTab === 'expenses'
                          ? 'border-indigo-600 text-indigo-700'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>Bills</span>
                      <span className="text-[10px] bg-slate-50 border border-slate-150 text-slate-500 py-0.2 px-1.5 rounded-md font-mono font-medium">
                        {currentGroup.expenses.length}
                      </span>
                    </button>
                    <button
                      onClick={() => setActiveTab('settle')}
                      className={`flex-1 py-3 text-xs font-bold text-center border-b-2 transition-all flex items-center justify-center space-x-1.5 ${
                        activeTab === 'settle'
                          ? 'border-indigo-600 text-indigo-700'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Coins className="w-3.5 h-3.5" />
                      <span>Settle Debts</span>
                      {calculateSettlements(currentGroup.friends, currentGroup.expenses).length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] mt-0.5"></span>
                      )}
                    </button>
                    <button
                      onClick={() => setActiveTab('members')}
                      className={`flex-1 py-3 text-xs font-bold text-center border-b-2 transition-all flex items-center justify-center space-x-1.5 ${
                        activeTab === 'members'
                          ? 'border-indigo-600 text-indigo-700'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Teammates</span>
                    </button>
                  </div>

                  {/* Render content panels */}
                  <div className="flex-1 overflow-hidden relative">
                    
                    {/* 1. EXPENSES LIST SECTION */}
                    {activeTab === 'expenses' && (
                      <div className="h-full flex flex-col bg-[#fafafc]">
                        
                        {/* Search / Filters area widget */}
                        <div className="px-4.5 py-3 border-b border-slate-100 bg-white flex flex-col sm:flex-row gap-2 shrink-0">
                          <div className="relative flex-1">
                            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                            <input
                              type="text"
                              placeholder="Search bills or friends..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full h-8.5 pl-9 pr-6.5 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-400 bg-slate-50 text-xs"
                            />
                            {searchQuery && (
                              <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="flex space-x-2 shrink-0">
                            {/* Selector for categories */}
                            <div className="relative flex-1">
                              <select
                                value={filterCategory}
                                onChange={(e) => setFilterCategory(e.target.value)}
                                className="w-full h-8.5 py-1 pl-2.5 pr-6 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-600 appearance-none font-semibold focus:outline-none focus:border-indigo-400 cursor-pointer"
                              >
                                <option value="all">Any Category</option>
                                {CATEGORIES.map(cat => (
                                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                              </select>
                              <div className="pointer-events-none absolute right-2.5 top-2.5 text-slate-400">
                                <ListFilter className="w-3 h-3" />
                              </div>
                            </div>

                            {/* Selector for static friend payer */}
                            <div className="relative flex-1">
                              <select
                                value={filterPayer}
                                onChange={(e) => setFilterPayer(e.target.value)}
                                className="w-full h-8.5 py-1 pl-2.5 pr-6 border border-slate-200 rounded-lg text-xs bg-slate-50 text-slate-600 appearance-none font-semibold focus:outline-none focus:border-indigo-400 cursor-pointer"
                              >
                                <option value="all">Any Payer</option>
                                {currentGroup.friends.map(f => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                              <div className="pointer-events-none absolute right-2.5 top-2.5 text-slate-400">
                                <Users className="w-3 h-3" />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Scrolling list view */}
                        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                          {/* Dynamic Spending over time visualizer */}
                          <SpendingChart 
                            expenses={displayExpenses} 
                            currencySymbol={viewInSgd ? 'S$' : currentGroup.currency} 
                          />

                          {filteredExpenses.length === 0 ? (
                            <div className="py-16 text-center">
                              <div className="p-3 bg-slate-50 rounded-full inline-block text-slate-400 mb-2 border border-slate-100">
                                {currentGroup.expenses.length === 0 ? (
                                  <Receipt className="w-5 h-5" />
                                ) : (
                                  <Search className="w-5 h-5" />
                                )}
                              </div>
                              {currentGroup.expenses.length === 0 ? (
                                <>
                                  <p className="text-xs font-semibold text-slate-450 uppercase tracking-wider">No bills recorded yet.</p>
                                  <p className="text-[11px] text-slate-400 mt-0.5">Tap "Record spending" to add your first expense.</p>
                                </>
                              ) : (
                                <>
                                  <p className="text-xs font-semibold text-slate-450 uppercase tracking-wider">No matching bills found.</p>
                                  <p className="text-[11px] text-slate-400 mt-0.5">Try modifying your query or filter keywords.</p>
                                </>
                              )}
                            </div>
                          ) : (
                            filteredExpenses.map(expense => {
                              const payer = currentGroup.friends.find(f => f.id === expense.paidBy)?.name || 'Someone';
                              const categorySpec = CATEGORIES.find(c => c.id === expense.category) || CATEGORIES[CATEGORIES.length - 1];
                              const originalExpense = currentGroup.expenses.find(e => e.id === expense.id) || expense;

                              return (
                                <div
                                  key={expense.id}
                                  onClick={() => {
                                    if (expense.isSettlement) {
                                      setDeleteConfirm({
                                        type: 'settlement',
                                        id: expense.id,
                                        title: 'Delete Settlement Record',
                                        desc: `Are you sure you want to delete the settlement: "${expense.title}"? Deleting this record will restore the outstanding balances between these members.`,
                                        overrideLabel: 'Yes, Delete Record'
                                      });
                                    } else {
                                      setExpenseToEdit(expense);
                                      setShowExpenseForm(true);
                                    }
                                  }}
                                  className={`rounded-xl p-3 border.5 transition-all cursor-pointer flex items-center justify-between hover:translate-x-0.5 hover:shadow-2xs select-none ${
                                    expense.isSettlement
                                      ? 'bg-indigo-50/10 border-dashed border-indigo-200 hover:bg-indigo-50/20'
                                      : 'bg-white border-slate-150 hover:border-indigo-150'
                                  }`}
                                >
                                  <div className="flex items-center space-x-3 min-w-0 flex-1 pr-2">
                                    <div className={`p-2 rounded-lg shrink-0 ${categorySpec.bgColorClass} ${categorySpec.colorClass}`}>
                                      {getCategoryIcon(categorySpec.iconName, 'w-4 h-4')}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex items-center space-x-1.5 min-w-0">
                                        <h4 className={`text-xs font-bold truncate ${expense.isSettlement ? 'text-indigo-900' : 'text-slate-800'}`}>
                                          {expense.title}
                                        </h4>
                                        {originalExpense.originalCurrency && (
                                          <span className="shrink-0 bg-amber-50 text-amber-700 border border-amber-200/50 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full" title={`Recorded in ${originalExpense.originalCurrency}`}>
                                            {originalExpense.originalCurrency}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center space-x-1.5 text-[10px] text-slate-450 mt-1 font-medium font-sans animate-fade-in">
                                        <span className="font-semibold text-slate-600">{payer}</span>
                                        <span>paid</span>
                                        <span className="font-mono bg-slate-100 text-slate-600 px-1 rounded-sm leading-tight inline-block font-bold">
                                          {formatCurrency(expense.amount, viewInSgd ? 'S$' : currentGroup.currency)}
                                        </span>
                                        <span className="text-[9px] shrink-0 font-mono text-slate-400">{expense.date}</span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="text-right shrink-0">
                                    {expense.isSettlement ? (
                                      <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100/50 py-0.5 px-2.5 rounded-full inline-block">
                                        Settle Record
                                      </span>
                                    ) : (
                                      <div>
                                        <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Amount</p>
                                        <p className="text-xs font-bold text-slate-800 font-mono leading-tight mt-0.5">
                                          {formatCurrency(expense.amount, viewInSgd ? 'S$' : currentGroup.currency)}
                                        </p>
                                        <p className="text-[9px] mt-0.5 leading-none">
                                          {originalExpense.originalCurrency ? (
                                            <span className="text-amber-600 font-mono font-bold">
                                              Orig. {CURRENCIES.find(c => c.code === originalExpense.originalCurrency)?.symbol || originalExpense.originalCurrency}
                                              {originalExpense.originalAmount?.toFixed(2)}
                                            </span>
                                          ) : viewInSgd ? (
                                            <span className="text-indigo-600 font-mono font-bold">Orig. {currentGroup.currency}{originalExpense.amount.toFixed(2)}</span>
                                          ) : (
                                            <span className="text-slate-400 font-medium">
                                              {expense.splitType === 'equal' 
                                                ? `for ${expense.splitAmong.length} pax` 
                                                : 'custom split'}
                                            </span>
                                          )}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}

                    {/* 2. SETTLEMENT DEBTS TAB */}
                    {activeTab === 'settle' && (() => {
                      const balances = calculateBalances(currentGroup.friends, displayExpenses);
                      const settlements = calculateSettlements(currentGroup.friends, displayExpenses);

                      return (
                        <div className="h-full flex flex-col bg-[#fafafc] overflow-y-auto px-4.5 py-4 space-y-4">
                          
                          {/* Settle info share sheet */}
                          <div className="p-4 bg-indigo-50/40 border border-indigo-100/60 rounded-xl text-indigo-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold font-display">Who owes who?</p>
                              <p className="text-[11px] text-slate-500 mt-0.5">Optimized debt resolution summary matrix</p>
                            </div>
                            <button
                              onClick={handleCopySummary}
                              className="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-[10px] tracking-wide transition-all active:scale-95"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy WhatsApp Text</span>
                            </button>
                          </div>

                          {/* Suggested Payments ledger */}
                          <div className="space-y-2">
                            <h3 className="text-[10px] font-bold text-slate-450 tracking-wider uppercase px-0.5">Suggested Payments</h3>
                            
                            {settlements.length === 0 ? (
                              <div className="bg-white border border-slate-150 rounded-xl p-6 text-center">
                                <div className="w-9 h-9 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2 border border-emerald-100/50">
                                  <Check className="w-4 h-4 stroke-[3]" />
                                </div>
                                <p className="text-xs font-bold text-slate-800">Everyone is fully balanced!</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">No outstanding transfers required.</p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {settlements.map((settle, idx) => (
                                  <div
                                    key={idx}
                                    className="bg-white border border-slate-150 rounded-xl p-3 flex items-center justify-between"
                                  >
                                    <div className="space-y-0.5">
                                      <div className="flex items-center space-x-1.5 flex-wrap">
                                        <span className="text-xs font-bold text-slate-800">{settle.fromName}</span>
                                        <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                                        <span className="text-xs font-bold text-slate-800">{settle.toName}</span>
                                      </div>
                                      <p className="text-sm font-bold text-emerald-600 font-mono">
                                        {formatCurrency(settle.amount, viewInSgd ? 'S$' : currentGroup.currency)}
                                      </p>
                                    </div>

                                    <button
                                      onClick={() => handleQuickSettle(settle)}
                                      className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-bold transition-all border border-emerald-100/50 active:scale-95 select-none"
                                    >
                                      <CheckCircle className="w-3.5 h-3.5" />
                                      <span>Mark Paid</span>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Individual list balances matrix */}
                          <div className="space-y-2">
                            <h3 className="text-[10px] font-bold text-slate-450 tracking-wider uppercase px-0.5">Individual Matrix Bilateral</h3>
                            <div className="bg-white border border-slate-150 rounded-xl divide-y divide-slate-100 overflow-hidden">
                              {currentGroup.friends.map(friend => {
                                const bal = balances[friend.id] ?? 0;
                                const isPositive = bal > 0.005;
                                const isNegative = bal < -0.005;

                                return (
                                  <div key={friend.id} className="p-3.5 flex items-center justify-between">
                                    <span className="text-xs font-semibold text-slate-700">{friend.name}</span>
                                    <div className="text-right">
                                      <span className={`text-xs font-bold font-mono ${
                                        isPositive ? 'text-emerald-600' : isNegative ? 'text-rose-600' : 'text-slate-400'
                                      }`}>
                                        {isPositive ? '+' : ''}
                                        {formatCurrency(bal, viewInSgd ? 'S$' : currentGroup.currency)}
                                      </span>
                                      <p className="text-[9px] text-slate-450 font-medium">
                                        {isPositive ? 'is owed' : isNegative ? 'owes total' : 'perfectly settled'}
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 3. TEAMMATES MANAGEMENT GRID SECTION */}
                    {activeTab === 'members' && (
                      <div className="h-full flex flex-col bg-[#fafafc] overflow-y-auto px-4.5 py-4 space-y-4">
                        
                        {/* Add teammates form inside */}
                        <form onSubmit={handleAddFriendToActiveGroup} className="bg-white border border-slate-150 rounded-xl p-4.5 space-y-3 shrink-0">
                          <div>
                            <h4 className="text-xs font-bold text-slate-800">Add New Partner mid-trip</h4>
                            <p className="text-[10px] text-slate-450 mt-0.5">They can split future transactions added to this trip.</p>
                          </div>
                          <div className="flex space-x-2">
                            <div className="relative flex-1">
                              <UserPlus className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                              <input
                                type="text"
                                placeholder="Teammate name (e.g. Emily)"
                                value={newFriendNameActive}
                                onChange={(e) => setNewFriendNameActive(e.target.value)}
                                className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-400 bg-slate-50 text-xs"
                                maxLength={20}
                              />
                            </div>
                            <button
                              type="submit"
                              className="px-4.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition-all flex items-center space-x-1"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Add</span>
                            </button>
                          </div>
                        </form>

                        {/* List teammates and comparative scales of payment */}
                        <div className="space-y-2 flex-1">
                          <h3 className="text-[10px] font-bold text-slate-450 tracking-wider uppercase px-0.5">Spending Shares Comparison</h3>
                          <div className="bg-white border border-slate-150 rounded-xl divide-y divide-slate-100 overflow-hidden">
                            {currentGroup.friends.map(friend => {
                              const totalPaid = currentGroup.expenses
                                .filter(e => e.paidBy === friend.id && !e.isSettlement)
                                .reduce((sum, e) => sum + e.amount, 0);

                              const maxPaid = Math.max(
                                ...currentGroup.friends.map(fr => 
                                  currentGroup.expenses
                                    .filter(e => e.paidBy === fr.id && !e.isSettlement)
                                    .reduce((sum, e) => sum + e.amount, 0)
                                ),
                                1
                              );

                              const pct = Math.min((totalPaid / maxPaid) * 100, 100);

                              return (
                                <div key={friend.id} className="p-3.5 flex flex-col space-y-2 bg-white">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2">
                                      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold text-[10px] text-slate-600 uppercase font-display select-none">
                                        {friend.name.slice(0, 2)}
                                      </div>
                                      <span className="text-xs font-bold text-slate-700">{friend.name}</span>
                                    </div>

                                    <div className="flex items-center space-x-3">
                                      <div className="text-right">
                                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Spent Total</p>
                                        <p className="text-xs font-bold text-slate-800 font-mono mt-0.5">
                                          {formatCurrency(totalPaid, currentGroup.currency)}
                                        </p>
                                      </div>

                                      <button
                                        onClick={() => handleRemoveFriendFromActiveGroup(friend.id)}
                                        className="p-1 px-1.5 rounded-lg text-slate-350 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden block">
                                    <div
                                      className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                                      style={{ width: `${pct}%` }}
                                    ></div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                      </div>
                    )}

                  </div>

                  {/* Fixed Sticky Mobile Footer bar (Hidden on lg sizes) */}
                  {currentGroup && !showExpenseForm && (
                    <div className="lg:hidden bg-white border-t border-slate-200/80 px-4 py-2.5 shrink-0 flex items-center justify-between text-slate-500 select-none">
                      <button
                        onClick={() => setActiveGroupId(null)}
                        className="flex flex-col items-center justify-center text-slate-450 hover:text-indigo-600 transition-colors py-1 flex-1"
                      >
                        <Wallet className="w-4 h-4 mb-0.5" />
                        <span className="text-[9px] font-bold tracking-wider">My Trips</span>
                      </button>
                      <div className="h-4 w-px bg-slate-200"></div>
                      <button
                        onClick={() => setShowExpenseForm(true)}
                        className="flex flex-col items-center justify-center text-indigo-600 font-bold py-1 flex-1 transition-all"
                      >
                        <Receipt className="w-4 h-4 mb-0.5 text-indigo-600" />
                        <span className="text-[9px] font-bold tracking-wider">Record Bill</span>
                      </button>
                      <div className="h-4 w-px bg-slate-200"></div>
                      <button
                        onClick={() => {
                          setActiveTab('settle');
                        }}
                        className="flex flex-col items-center justify-center text-slate-440 hover:text-indigo-600 transition-colors py-1 flex-1"
                      >
                        <Coins className="w-4 h-4 mb-0.5" />
                        <span className="text-[9px] font-bold tracking-wider">Balances</span>
                      </button>
                    </div>
                  )}

                </div>
              )}

            </main>

          </div>
        )}
      </div>

      {/* =========================================================================
         4. FLOATING CENTERED MODAL / COVER: Record Bill ExpenseForm
         ========================================================================= */}
      <AnimatePresence>
        {showExpenseForm && currentGroup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/15 backdrop-blur-xs flex items-center justify-center p-0 sm:p-4"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%', transition: { type: 'spring', damping: 25 } }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="absolute inset-x-0 bottom-0 top-[10%] sm:relative sm:inset-auto sm:top-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-xl h-[90%] sm:h-[620px] overflow-hidden flex flex-col border border-slate-200"
            >
              <ExpenseForm
                key={expenseToEdit ? expenseToEdit.id : 'new'}
                friends={currentGroup.friends}
                currencySymbol={currentGroup.currency}
                expenseToEdit={expenseToEdit}
                sgdExchangeRate={currentGroup.sgdExchangeRate || getDefaultExchangeRate(currentGroup.currency)}
                onSave={handleSaveExpense}
                onCancel={() => {
                  setShowExpenseForm(false);
                  setExpenseToEdit(null);
                }}
                onDelete={handleExpenseDeleteTrigger}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =========================================================================
         5. CREATE TRIP GROUP DIALOG DRAWER MODAL
         ========================================================================= */}
      <AnimatePresence>
        {showAddGroupModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-slate-900/35 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <motion.div
              initial={{ y: 120 }}
              animate={{ y: 0 }}
              exit={{ y: 120 }}
              className="bg-white rounded-t-3xl sm:rounded-2xl p-5.5 w-full sm:max-w-md space-y-4 max-h-[85vh] sm:max-h-none overflow-y-auto border border-slate-200 sm:shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-800 font-display">Create New Trip</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">Add teammates and specify preferred default currency.</p>
                </div>
                <button
                  onClick={() => setShowAddGroupModal(false)}
                  className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateGroup} className="space-y-4">
                {/* Trip Name field */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Trip Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Korea Trip Autumn 🍁"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 text-sm font-semibold"
                    required
                    maxLength={40}
                  />
                </div>

                {/* Description field */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Description (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Shinkansen tickets, airbnb and food split"
                    value={newGroupDesc}
                    onChange={(e) => setNewGroupDesc(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 text-sm"
                    maxLength={80}
                  />
                </div>

                {/* Preferred default Currency */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Preferred currency default</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {CURRENCIES.map(curr => (
                      <button
                        key={curr.code}
                        type="button"
                        onClick={() => setNewGroupCurrency(curr.symbol)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          newGroupCurrency === curr.symbol
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                        }`}
                      >
                        {curr.symbol} ({curr.code})
                      </button>
                    ))}
                  </div>
                </div>

                {/* Teammates section */}
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Group Teammates</label>
                    <p className="text-[10px] text-slate-450">Add friends who are in this trip to balance bills.</p>
                  </div>

                  <div className="flex space-x-2">
                    <input
                      type="text"
                      placeholder="Add friend (e.g. Dave)"
                      value={friendInput}
                      onChange={(e) => setFriendInput(e.target.value)}
                      className="flex-1 h-9 px-3 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                      maxLength={20}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddFriendToNewGroup();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddFriendToNewGroup}
                      className="px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-100 outline-none transition-colors"
                    >
                      Add Tag
                    </button>
                  </div>

                  {/* Tag List output */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {newGroupFriends.map((friendName, index) => (
                      <div
                        key={index}
                        className="flex items-center space-x-1 px-2.5 py-1 bg-slate-50 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 rounded-full text-xs font-medium cursor-pointer transition-colors"
                        onClick={() => handleRemoveFriendFromNewGroup(index)}
                      >
                        <span>{friendName}</span>
                        <X className="w-3 h-3 text-slate-400 hover:text-rose-500" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Form Actions */}
                <div className="flex space-x-2 border-t border-slate-100 pt-3.5">
                  <button
                    type="button"
                    onClick={() => setShowAddGroupModal(false)}
                    className="flex-1 h-10 border border-slate-200 hover:border-slate-300 text-slate-500 hover:text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 h-10 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center space-x-1.5"
                  >
                    <Check className="w-4 h-4" />
                    <span>Start Trip</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =========================================================================
         6. CUSTOM CONFIRMATION DELETE MODAL
         ========================================================================= */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-2xl p-5.5 w-full sm:max-w-md space-y-4 border border-slate-200 shadow-xl overflow-hidden text-left"
            >
              <div className="flex items-start space-x-3.5">
                <div className={`p-2.5 rounded-full ${deleteConfirm.warning ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'} shrink-0`}>
                  {deleteConfirm.warning ? (
                    <AlertTriangle className="w-5 h-5 stroke-[2]" />
                  ) : (
                    <Trash2 className="w-5 h-5 stroke-[2]" />
                  )}
                </div>
                <div className="space-y-1.5 flex-1">
                  <h3 className="text-sm font-bold text-slate-800 font-display">
                    {deleteConfirm.title}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {deleteConfirm.desc}
                  </p>
                </div>
              </div>

              {deleteConfirm.warning && (
                <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-3 flex items-start space-x-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 animate-pulse" />
                  <p className="text-[11px] leading-relaxed font-semibold text-amber-800">
                    {deleteConfirm.warning}
                  </p>
                </div>
              )}

              <div className="flex items-center space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 h-9.5 border border-slate-200 hover:border-slate-300 text-slate-500 hover:text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl text-center transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className={`flex-1 h-9.5 text-white font-bold text-xs rounded-xl shadow-xs transition-colors ${
                    deleteConfirm.warning
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {deleteConfirm.overrideLabel || 'Yes, Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =========================================================================
         6b. INVITE FRIENDS VIA SHAREABLE LINK MODAL
         ========================================================================= */}
      <AnimatePresence>
        {showInviteModal && currentGroup && inviteLink && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-2xl p-6 w-full sm:max-w-md space-y-4 border border-slate-200 shadow-xl overflow-hidden text-left"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1.5 flex-1">
                  <h3 className="text-sm font-bold text-slate-800 font-display flex items-center space-x-1.5">
                    <Share2 className="w-4 h-4 text-indigo-600" />
                    <span>Invite to "{currentGroup.name}"</span>
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Send this link to your friends — they just tap it to join the trip instantly, no code needed.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg transition-colors ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Copyable link field */}
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={inviteLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 h-10 bg-slate-50 border border-slate-200 rounded-xl px-3 text-[11px] text-slate-600 font-mono outline-none truncate"
                />
                <button
                  type="button"
                  onClick={handleCopyInviteLink}
                  className="h-10 px-3 bg-slate-100 hover:bg-slate-200/80 text-slate-600 rounded-xl transition-all flex items-center space-x-1 shrink-0"
                  title="Copy invite link"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">Copy</span>
                </button>
              </div>

              {/* Direct share shortcuts */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleShareToWhatsApp}
                  className="h-10 bg-emerald-50 hover:bg-emerald-100 border border-emerald-150/60 text-emerald-700 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition-all"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>WhatsApp</span>
                </button>
                <button
                  type="button"
                  onClick={handleShareToTelegram}
                  className="h-10 bg-sky-50 hover:bg-sky-100 border border-sky-150/60 text-sky-700 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition-all"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Telegram</span>
                </button>
              </div>

              {typeof navigator !== 'undefined' && !!navigator.share && (
                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition-all"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>More share options (Slack, iMessage, etc.)</span>
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
