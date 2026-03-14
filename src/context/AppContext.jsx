import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';

const AppContext = createContext();

const STORAGE_KEY = 'sitio_voo_dos_gansos_data';
const BACKUP_KEY = 'sitio_voo_dos_gansos_backup';
const FIRESTORE_DOC = doc(db, 'config', 'appData');

const defaultData = {
  investors: [],
  birds: [],
  sales: [],
  financialInvestments: [],
  customSpecies: [],
  payments: [],
  expenses: [],
  customExpenseCategories: [],
  eggCollections: [],
  incubators: [],
  incubatorBatches: [],
};

// Count total items across all arrays in data
const countItems = (d) =>
  (d.investors?.length || 0) +
  (d.birds?.length || 0) +
  (d.sales?.length || 0) +
  (d.financialInvestments?.length || 0) +
  (d.customSpecies?.length || 0) +
  (d.payments?.length || 0) +
  (d.expenses?.length || 0) +
  (d.customExpenseCategories?.length || 0) +
  (d.eggCollections?.length || 0) +
  (d.incubators?.length || 0) +
  (d.incubatorBatches?.length || 0);

// Default species (empty breeds - user adds breeds manually via the app)
export const BIRD_SPECIES = [];

export function AppProvider({ children }) {
  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(true);
  const [firestoreError, setFirestoreError] = useState(null);
  const lastLocalWriteTime = useRef(0);
  const dataLoadedFromFirestore = useRef(false);
  const firestoreItemCount = useRef(0);
  const pendingWriteCount = useRef(0);

  // Listen to Firestore in real-time
  useEffect(() => {
    const unsubscribe = onSnapshot(FIRESTORE_DOC, (snapshot) => {
      setFirestoreError(null);
      if (snapshot.exists()) {
        // Ignore Firestore snapshots while we have pending writes or shortly after a write
        // to prevent onSnapshot from overwriting local state with stale data
        const timeSinceWrite = Date.now() - lastLocalWriteTime.current;
        if (pendingWriteCount.current > 0 || timeSinceWrite < 5000) {
          setLoading(false);
          return;
        }
        const firestoreData = { ...defaultData, ...snapshot.data() };
        firestoreItemCount.current = countItems(firestoreData);
        dataLoadedFromFirestore.current = true;
        setData(firestoreData);
      } else {
        // First time: try to migrate from localStorage
        dataLoadedFromFirestore.current = true;
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const parsed = { ...defaultData, ...JSON.parse(stored) };
            lastLocalWriteTime.current = Date.now();
            setDoc(FIRESTORE_DOC, parsed);
            setData(parsed);
          }
        } catch {
          // ignore
        }
      }
      setLoading(false);
    }, (error) => {
      console.error('Firestore error:', error);
      setFirestoreError(error.code || error.message || 'Erro de conexao');
      // Fallback to localStorage if Firestore fails
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        setData(stored ? { ...defaultData, ...JSON.parse(stored) } : defaultData);
      } catch {
        setData(defaultData);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Save to Firestore when data changes (with protection against empty overwrites)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (loading) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // PROTECTION: Don't save until we've loaded from Firestore at least once
    if (!dataLoadedFromFirestore.current) return;

    const newCount = countItems(data);

    // PROTECTION: Block saving empty data if Firestore had data
    // (prevents accidental wipe from race conditions or bugs)
    if (newCount === 0 && firestoreItemCount.current > 0) {
      console.warn('Blocked: tentativa de salvar dados vazios no Firestore (havia', firestoreItemCount.current, 'itens)');
      return;
    }

    // BACKUP: Save previous version before overwriting
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) {
        const prev = JSON.parse(current);
        if (countItems(prev) > 0) {
          localStorage.setItem(BACKUP_KEY, JSON.stringify({
            data: prev,
            savedAt: new Date().toISOString(),
          }));
        }
      }
    } catch {
      // ignore backup errors
    }

    // Save to both Firestore and localStorage
    lastLocalWriteTime.current = Date.now();
    firestoreItemCount.current = newCount;
    pendingWriteCount.current += 1;
    setDoc(FIRESTORE_DOC, data)
      .catch(err => {
        console.error('Firestore save error:', err);
      })
      .finally(() => {
        pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
        // Update the write time when the write completes so the debounce window
        // starts AFTER the server confirms, not before
        lastLocalWriteTime.current = Date.now();
      });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, loading]);

  // Investors
  const addInvestor = (investor) => {
    const newInvestor = {
      ...investor,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({ ...prev, investors: [...prev.investors, newInvestor] }));
    return newInvestor;
  };

  const updateInvestor = (id, updates) => {
    setData(prev => ({
      ...prev,
      investors: prev.investors.map(i => i.id === id ? { ...i, ...updates } : i),
    }));
  };

  const deleteInvestor = (id) => {
    setData(prev => ({
      ...prev,
      investors: prev.investors.filter(i => i.id !== id),
      birds: prev.birds.filter(b => b.investorId !== id),
    }));
  };

  // Birds
  const addBird = (bird) => {
    const newBird = {
      ...bird,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({ ...prev, birds: [...prev.birds, newBird] }));
    return newBird;
  };

  const updateBird = (id, updates) => {
    setData(prev => ({
      ...prev,
      birds: prev.birds.map(b => b.id === id ? { ...b, ...updates } : b),
    }));
  };

  const deleteBird = (id) => {
    setData(prev => ({
      ...prev,
      birds: prev.birds.filter(b => b.id !== id),
    }));
  };

  // Sales
  const addSales = (salesList) => {
    setData(prev => ({
      ...prev,
      sales: [...prev.sales, ...salesList.map((s, i) => ({
        ...s,
        id: (Date.now() + i).toString(),
        importedAt: new Date().toISOString(),
      }))],
    }));
  };

  const clearSales = () => {
    setData(prev => ({ ...prev, sales: [] }));
  };

  const deleteSale = (id) => {
    setData(prev => ({
      ...prev,
      sales: prev.sales.filter(s => s.id !== id),
    }));
  };

  const updateSale = (id, updates) => {
    setData(prev => ({
      ...prev,
      sales: prev.sales.map(s => s.id === id ? { ...s, ...updates } : s),
    }));
  };

  // Custom Species
  const addCustomSpecies = (speciesData) => {
    setData(prev => {
      // Check if species already exists in custom list (case-insensitive)
      const existing = prev.customSpecies.find(s => s.species.toLowerCase() === speciesData.species.toLowerCase());
      if (existing) {
        // Add new breeds to existing custom species
        const newBreeds = speciesData.breeds.filter(b => !existing.breeds.includes(b));
        if (newBreeds.length === 0) return prev;
        return {
          ...prev,
          customSpecies: prev.customSpecies.map(s =>
            s.species.toLowerCase() === speciesData.species.toLowerCase()
              ? { ...s, breeds: [...s.breeds, ...newBreeds] }
              : s
          ),
        };
      }
      // Check if species exists in built-in list (case-insensitive)
      const builtIn = BIRD_SPECIES.find(s => s.species.toLowerCase() === speciesData.species.toLowerCase());
      if (builtIn) {
        // Only store breeds that aren't already in the built-in list
        const newBreeds = speciesData.breeds.filter(b => !builtIn.breeds.includes(b));
        if (newBreeds.length === 0) return prev;
        // Use the built-in species name (correct casing) for consistency
        return { ...prev, customSpecies: [...prev.customSpecies, { species: builtIn.species, breeds: newBreeds }] };
      }
      return { ...prev, customSpecies: [...prev.customSpecies, speciesData] };
    });
  };

  const deleteCustomSpecies = (speciesName) => {
    setData(prev => ({
      ...prev,
      customSpecies: prev.customSpecies.filter(s => s.species !== speciesName),
    }));
  };

  // Financial Investments
  const addFinancialInvestment = (investment) => {
    const newInv = {
      ...investment,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      financialInvestments: [...prev.financialInvestments, newInv],
    }));
    return newInv;
  };

  const deleteFinancialInvestment = (id) => {
    setData(prev => ({
      ...prev,
      financialInvestments: prev.financialInvestments.filter(i => i.id !== id),
    }));
  };

  // Payments (withdrawals / profit sent to investor)
  const addPayment = (payment) => {
    const newPayment = {
      ...payment,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      payments: [...(prev.payments || []), newPayment],
    }));
    return newPayment;
  };

  const deletePayment = (id) => {
    setData(prev => ({
      ...prev,
      payments: (prev.payments || []).filter(p => p.id !== id),
    }));
  };

  // Expenses (operational costs)
  const addExpense = (expense) => {
    const newExpense = {
      ...expense,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      expenses: [...(prev.expenses || []), newExpense],
    }));
    return newExpense;
  };

  const updateExpense = (id, updates) => {
    setData(prev => ({
      ...prev,
      expenses: (prev.expenses || []).map(e => e.id === id ? { ...e, ...updates } : e),
    }));
  };

  const deleteExpense = (id) => {
    setData(prev => ({
      ...prev,
      expenses: (prev.expenses || []).filter(e => e.id !== id),
    }));
  };

  // Custom Expense Categories
  const addCustomExpenseCategory = (category) => {
    setData(prev => {
      const existing = prev.customExpenseCategories || [];
      if (existing.some(c => c.name.toLowerCase() === category.name.toLowerCase())) return prev;
      return { ...prev, customExpenseCategories: [...existing, { ...category, id: Date.now().toString() }] };
    });
  };

  const deleteCustomExpenseCategory = (id) => {
    setData(prev => ({
      ...prev,
      customExpenseCategories: (prev.customExpenseCategories || []).filter(c => c.id !== id),
    }));
  };

  // Egg Collections
  const addEggCollection = (collection) => {
    const newCollection = {
      ...collection,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      eggCollections: [...(prev.eggCollections || []), newCollection],
    }));
    return newCollection;
  };

  const updateEggCollection = (id, updates) => {
    setData(prev => ({
      ...prev,
      eggCollections: (prev.eggCollections || []).map(c => c.id === id ? { ...c, ...updates } : c),
    }));
  };

  const deleteEggCollection = (id) => {
    setData(prev => ({
      ...prev,
      eggCollections: (prev.eggCollections || []).filter(c => c.id !== id),
    }));
  };

  // Incubators
  const addIncubator = (incubator) => {
    const newIncubator = { ...incubator, id: Date.now().toString(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, incubators: [...(prev.incubators || []), newIncubator] }));
    return newIncubator;
  };
  const updateIncubator = (id, updates) => {
    setData(prev => ({ ...prev, incubators: (prev.incubators || []).map(i => i.id === id ? { ...i, ...updates } : i) }));
  };
  const deleteIncubator = (id) => {
    setData(prev => ({
      ...prev,
      incubators: (prev.incubators || []).filter(i => i.id !== id),
      incubatorBatches: (prev.incubatorBatches || []).filter(b => b.incubatorId !== id),
    }));
  };

  // Incubator Batches
  const addIncubatorBatch = (batch) => {
    const newBatch = { ...batch, id: Date.now().toString(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, incubatorBatches: [...(prev.incubatorBatches || []), newBatch] }));
    return newBatch;
  };
  const updateIncubatorBatch = (id, updates) => {
    setData(prev => ({ ...prev, incubatorBatches: (prev.incubatorBatches || []).map(b => b.id === id ? { ...b, ...updates } : b) }));
  };
  const deleteIncubatorBatch = (id) => {
    setData(prev => ({ ...prev, incubatorBatches: (prev.incubatorBatches || []).filter(b => b.id !== id) }));
  };

  const value = {
    ...data,
    loading,
    firestoreError,
    addInvestor, updateInvestor, deleteInvestor,
    addBird, updateBird, deleteBird,
    addSales, clearSales, deleteSale, updateSale,
    addFinancialInvestment, deleteFinancialInvestment,
    addPayment, deletePayment,
    addExpense, updateExpense, deleteExpense,
    addCustomExpenseCategory, deleteCustomExpenseCategory,
    addEggCollection, updateEggCollection, deleteEggCollection,
    addIncubator, updateIncubator, deleteIncubator,
    addIncubatorBatch, updateIncubatorBatch, deleteIncubatorBatch,
    addCustomSpecies, deleteCustomSpecies,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
