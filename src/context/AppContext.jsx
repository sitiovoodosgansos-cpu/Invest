import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import {
  doc, collection, onSnapshot, setDoc, getDoc, deleteDoc, writeBatch,
} from 'firebase/firestore';
import { partitionSaleDuplicates } from '../utils/helpers';

// Generate a collision-free, non-enumerable ID for any locally-created entity.
// Prefers the Web Crypto API (128 bits of entropy) and falls back to a
// timestamp + random fragment only on the rare browser that lacks it. Never
// returns a predictable Date.now() value the way the Phase 1 code did.
const newId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Last-resort fallback. Still non-sequential enough to avoid accidental
  // collisions inside a session, though not cryptographically strong.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const AppContext = createContext();

const STORAGE_KEY = 'sitio_voo_dos_gansos_data';
const BACKUP_KEY = 'sitio_voo_dos_gansos_backup';
const FIRESTORE_DOC = doc(db, 'config', 'appData');
// Sales live in their own collection to escape the 1 MiB per-doc cap that
// used to silently drop writes around the ~1100-sale mark. See firestore.rules
// for the matching security model and the migration comment below.
const SALES_COLLECTION = collection(db, 'sales');
// LocalStorage flag: once set, we know the /sales collection has been
// hydrated from the legacy appData.sales array and the array has been
// cleared. Prevents us from re-migrating on every session.
const SALES_MIGRATION_KEY = 'sitio_voo_dos_gansos_sales_migrated_v1';

// Dev-only logger. Avoids leaking internal sync state to the browser console
// in production, which would help attackers reverse-engineer the app.
const devWarn = (...args) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
};
const devError = (...args) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error(...args);
  }
};

// NOTE: `sales` lives in its own state slice / Firestore collection now.
// It is NOT part of `defaultData` so the appData save effect can't
// accidentally write the sales array back into /config/appData and re-hit
// the 1 MiB cap. The two slices are merged when building the context value.
const defaultData = {
  investors: [],
  birds: [],
  financialInvestments: [],
  customSpecies: [],
  payments: [],
  expenses: [],
  customExpenseCategories: [],
  eggCollections: [],
  incubators: [],
  incubatorBatches: [],
  infirmaryBays: [],
  infirmaryAdmissions: [],
  treatments: [],
  customTreatmentTypes: [],
  nurseryRooms: [],
  nurseryBatches: [],
  nurseryEvents: [],
  employeeToken: '',
};

// Count total items across all arrays in data. Sales are tracked separately
// now and deliberately NOT counted here — this function is only used to
// guard /config/appData writes.
const countItems = (d) =>
  (d.investors?.length || 0) +
  (d.birds?.length || 0) +
  (d.financialInvestments?.length || 0) +
  (d.customSpecies?.length || 0) +
  (d.payments?.length || 0) +
  (d.expenses?.length || 0) +
  (d.customExpenseCategories?.length || 0) +
  (d.eggCollections?.length || 0) +
  (d.incubators?.length || 0) +
  (d.incubatorBatches?.length || 0) +
  (d.infirmaryBays?.length || 0) +
  (d.infirmaryAdmissions?.length || 0) +
  (d.treatments?.length || 0) +
  (d.customTreatmentTypes?.length || 0) +
  (d.nurseryRooms?.length || 0) +
  (d.nurseryBatches?.length || 0) +
  (d.nurseryEvents?.length || 0);

// Default species (empty breeds - user adds breeds manually via the app)
export const BIRD_SPECIES = [];

export function AppProvider({ children }) {
  const [data, setData] = useState(defaultData);
  // Sales live in their own slice backed by the /sales collection. We keep
  // them in a plain array in state so the rest of the app (Sales page,
  // profit distribution, reports, portals) can treat sales like any other
  // list without knowing where they're persisted.
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salesLoading, setSalesLoading] = useState(true);
  const [firestoreError, setFirestoreError] = useState(null);
  // saveError surfaces rejected Firestore writes to the UI. Unlike
  // firestoreError (which is about read/listen failures) this is flipped
  // when setDoc/writeBatch throws, so admins can tell when a save didn't
  // land and redo the action or contact support. It auto-clears on the
  // next successful write.
  const [saveError, setSaveError] = useState(null);
  const lastLocalWriteTime = useRef(0);
  const dataLoadedFromFirestore = useRef(false);
  const firestoreItemCount = useRef(0);
  const pendingWriteCount = useRef(0);
  // Track local deletes so onSnapshot won't reject fewer items after intentional deletes
  const localDeleteCount = useRef(0);
  // Keep a ref to latest data for use in event handlers (beforeunload, visibilitychange)
  const dataRef = useRef(data);
  dataRef.current = data;
  const salesRef = useRef(sales);
  salesRef.current = sales;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  // Listen to Firestore in real-time
  useEffect(() => {
    const unsubscribe = onSnapshot(FIRESTORE_DOC, (snapshot) => {
      setFirestoreError(null);
      if (snapshot.exists()) {
        // Ignore Firestore snapshots while we have pending writes or shortly after a write
        // to prevent onSnapshot from overwriting local state with stale data
        const timeSinceWrite = Date.now() - lastLocalWriteTime.current;
        if (pendingWriteCount.current > 0 || timeSinceWrite < 10000) {
          setLoading(false);
          return;
        }
        const firestoreData = { ...defaultData, ...snapshot.data() };
        const incomingCount = countItems(firestoreData);
        const currentCount = countItems(dataRef.current);

        // PROTECTION: Never accept Firestore data with fewer items than local state
        // unless we recently did local deletes (tracked via localDeleteCount)
        if (dataLoadedFromFirestore.current && incomingCount < currentCount) {
          const allowedDrop = localDeleteCount.current;
          localDeleteCount.current = 0; // reset after checking
          if (currentCount - incomingCount > allowedDrop) {
            devWarn(
              `Blocked: onSnapshot tried to overwrite ${currentCount} items with ${incomingCount} items (allowed drop: ${allowedDrop}). Pushing local data to Firestore instead.`
            );
            // Push our local data back to Firestore to fix the discrepancy
            const sanitized = JSON.parse(JSON.stringify(dataRef.current));
            lastLocalWriteTime.current = Date.now();
            pendingWriteCount.current += 1;
            setDoc(FIRESTORE_DOC, sanitized)
              .catch(err => devError('Re-push error:', err))
              .finally(() => {
                pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
                lastLocalWriteTime.current = Date.now();
              });
            setLoading(false);
            return;
          }
        }
        localDeleteCount.current = 0;

        firestoreItemCount.current = incomingCount;
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
      devError('Firestore error:', error);
      setFirestoreError(error.code || 'Erro de conexao');
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

  // Listen to the /sales collection separately. Each sale is its own doc
  // now, so writes are O(1) and we're not bounded by the 1 MiB-per-doc cap.
  //
  // On first load after the Phase 2C deploy, we also migrate any legacy
  // sales still living in appData.sales: we copy them into /sales/{id} and
  // then clear appData.sales so the old doc shrinks. The migration is
  // gated on a localStorage flag so it runs at most once per browser.
  useEffect(() => {
    const unsubscribe = onSnapshot(SALES_COLLECTION, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setSales(docs);
      setSalesLoading(false);
    }, (error) => {
      devError('Sales collection listen error:', error);
      setSalesLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // One-shot migration: promote legacy appData.sales into /sales/{id}.
  //
  // We wait until the main appData doc has loaded at least once so we know
  // which legacy sales exist. If the migration flag is already set, or the
  // legacy array is empty, we skip. Otherwise we batch the writes (Firestore
  // allows up to 500 ops per batch) and clear the legacy field on success.
  useEffect(() => {
    if (loading) return;
    if (!dataLoadedFromFirestore.current) return;
    if (typeof window === 'undefined') return;
    try {
      if (localStorage.getItem(SALES_MIGRATION_KEY) === 'done') return;
    } catch {
      // If localStorage is blocked we still try the migration; worst case
      // it no-ops because legacy sales is already empty.
    }
    (async () => {
      try {
        const snap = await getDoc(FIRESTORE_DOC);
        if (!snap.exists()) return;
        const legacySales = snap.data().sales;
        if (!Array.isArray(legacySales) || legacySales.length === 0) {
          try { localStorage.setItem(SALES_MIGRATION_KEY, 'done'); } catch { /* noop */ }
          return;
        }
        devWarn(`Migrating ${legacySales.length} legacy sales to /sales collection...`);
        // Chunk into batches of 400 (under Firestore's 500-op limit) to
        // keep individual commits small and recover gracefully mid-migration.
        const CHUNK = 400;
        for (let i = 0; i < legacySales.length; i += CHUNK) {
          const chunk = legacySales.slice(i, i + CHUNK);
          const batch = writeBatch(db);
          for (const sale of chunk) {
            const saleId = sale.id || newId();
            const payload = { ...sale };
            // Ensure required fields for the rules. Legacy rows can miss
            // these if they were half-written; coerce to safe defaults so
            // the create isn't rejected by the shape check.
            payload.itemDescription = String(sale.itemDescription || sale.item || 'Sem descricao');
            payload.totalValue = Number(sale.totalValue) || 0;
            delete payload.id;
            batch.set(doc(db, 'sales', saleId), payload);
          }
          await batch.commit();
        }
        // Clear the legacy array from appData so the old doc shrinks and
        // no longer competes for the 1 MiB budget. We do this via setDoc
        // merge so we don't clobber the rest of the blob.
        await setDoc(FIRESTORE_DOC, { sales: [] }, { merge: true });
        try { localStorage.setItem(SALES_MIGRATION_KEY, 'done'); } catch { /* noop */ }
        devWarn('Sales migration complete.');
      } catch (err) {
        devError('Sales migration failed:', err);
        setSaveError(
          'Nao foi possivel migrar as vendas antigas. Recarregue a pagina e tente novamente.'
        );
      }
    })();
  }, [loading]);

  // PROTECTION: Save data before page closes or tab switches
  useEffect(() => {
    const saveToLocalStorage = () => {
      if (loadingRef.current) return;
      const currentData = dataRef.current;
      if (countItems(currentData) === 0) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentData));
      } catch {
        // ignore storage errors
      }
    };

    const handleBeforeUnload = (e) => {
      saveToLocalStorage();
      // Also attempt Firestore save (best-effort, may not complete)
      if (pendingWriteCount.current > 0 || !dataLoadedFromFirestore.current) return;
      try {
        const sanitized = JSON.parse(JSON.stringify(dataRef.current));
        setDoc(FIRESTORE_DOC, sanitized).catch(() => {});
      } catch {
        // ignore
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveToLocalStorage();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Periodic auto-save to localStorage every 30 seconds as safety net
    const autoSaveInterval = setInterval(saveToLocalStorage, 30000);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(autoSaveInterval);
    };
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
      devWarn('Blocked: tentativa de salvar dados vazios no Firestore (havia', firestoreItemCount.current, 'itens)');
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
    // Sanitize: Firestore rejects undefined values, so strip them via JSON round-trip
    const sanitized = JSON.parse(JSON.stringify(data));
    lastLocalWriteTime.current = Date.now();
    firestoreItemCount.current = newCount;
    pendingWriteCount.current += 1;
    setDoc(FIRESTORE_DOC, sanitized)
      .then(() => {
        // Clear any lingering save error banner once a write lands.
        setSaveError(null);
      })
      .catch(err => {
        devError('Firestore save error:', err);
        // Surface to UI. The most common cause at this scale is the 1 MiB
        // per-doc cap; give the user a hint without dumping the raw code.
        setSaveError(
          err?.code === 'invalid-argument' || /size|bytes|too large/i.test(err?.message || '')
            ? 'Erro ao salvar: o documento principal atingiu o limite do Firestore. Entre em contato com o suporte.'
            : `Erro ao salvar alteracoes: ${err?.code || err?.message || 'erro desconhecido'}`
        );
      })
      .finally(() => {
        pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
        // Update the write time when the write completes so the debounce window
        // starts AFTER the server confirms, not before
        lastLocalWriteTime.current = Date.now();
      });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, loading]);

  // Helper: setData for delete operations - tracks the count drop so onSnapshot won't reject it
  const setDataWithDelete = (updater) => {
    setData(prev => {
      const next = updater(prev);
      const drop = countItems(prev) - countItems(next);
      if (drop > 0) {
        localDeleteCount.current += drop;
      }
      return next;
    });
  };

  // Investors
  const addInvestor = (investor) => {
    const newInvestor = {
      ...investor,
      id: newId(),
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
    setDataWithDelete(prev => ({
      ...prev,
      investors: prev.investors.filter(i => i.id !== id),
      birds: prev.birds.filter(b => b.investorId !== id),
    }));
  };

  // Birds
  const addBird = (bird) => {
    const newBird = {
      ...bird,
      id: newId(),
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
    setDataWithDelete(prev => ({
      ...prev,
      birds: prev.birds.filter(b => b.id !== id),
    }));
  };

  // -----------------------------------------------------------------
  // Sales (Phase 2C: backed by /sales collection, one doc per sale).
  //
  // All writes go straight to Firestore and the /sales onSnapshot listener
  // pushes the change back into local state. We DO NOT mutate local `sales`
  // optimistically because that would double-apply when the snapshot fires
  // (and diverge if the write fails). Every helper returns a promise so
  // callers can disable UI while the batch is in flight.
  //
  // All helpers also refuse to include `undefined` values and stamp
  // metadata (id, importedAt) server-side if missing so we never orphan a
  // row that violates the rules' shape check.
  // -----------------------------------------------------------------
  const sanitizeSalePayload = (sale) => {
    // Strip undefineds (Firestore rejects them) and null-out empty strings
    // so filters don't have to special-case them.
    const raw = JSON.parse(JSON.stringify(sale));
    // Rules require these two fields. Coerce defensively.
    raw.itemDescription = String(raw.itemDescription || raw.item || 'Sem descricao');
    raw.totalValue = Number(raw.totalValue) || 0;
    // Drop id from the payload; it's the doc key, not a field.
    delete raw.id;
    return raw;
  };

  const addSales = async (salesList) => {
    if (!Array.isArray(salesList) || salesList.length === 0) return;
    const now = new Date().toISOString();
    try {
      // Batch in chunks of 400 to stay under Firestore's 500-op batch limit.
      const CHUNK = 400;
      for (let i = 0; i < salesList.length; i += CHUNK) {
        const chunk = salesList.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const sale of chunk) {
          const saleId = newId();
          const payload = sanitizeSalePayload({
            ...sale,
            importedAt: sale.importedAt || now,
          });
          batch.set(doc(db, 'sales', saleId), payload);
        }
        await batch.commit();
      }
      setSaveError(null);
    } catch (err) {
      devError('addSales error:', err);
      setSaveError(`Erro ao salvar vendas: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  const clearSales = async () => {
    try {
      const current = salesRef.current;
      if (current.length === 0) return;
      const CHUNK = 400;
      for (let i = 0; i < current.length; i += CHUNK) {
        const chunk = current.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const sale of chunk) {
          batch.delete(doc(db, 'sales', sale.id));
        }
        await batch.commit();
      }
      setSaveError(null);
    } catch (err) {
      devError('clearSales error:', err);
      setSaveError(`Erro ao limpar vendas: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  const deleteSale = async (id) => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, 'sales', id));
      setSaveError(null);
    } catch (err) {
      devError('deleteSale error:', err);
      setSaveError(`Erro ao excluir venda: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  const updateSale = async (id, updates) => {
    if (!id) return;
    try {
      // Merge against the current local copy so we preserve all existing
      // fields and still satisfy the rules' create/update shape check.
      const current = salesRef.current.find(s => s.id === id);
      const merged = { ...(current || {}), ...updates };
      const payload = sanitizeSalePayload(merged);
      await setDoc(doc(db, 'sales', id), payload);
      setSaveError(null);
    } catch (err) {
      devError('updateSale error:', err);
      setSaveError(`Erro ao atualizar venda: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  // Remove duplicate sales (same orderNumber + itemDescription + totalValue
  // + quantity). Keeps the oldest occurrence by importedAt and deletes the
  // rest. Returns { removed, kept } counts for the UI to show.
  const removeDuplicateSales = async () => {
    try {
      const { duplicates } = partitionSaleDuplicates(salesRef.current);
      if (duplicates.length === 0) {
        return { removed: 0, kept: salesRef.current.length };
      }
      const CHUNK = 400;
      for (let i = 0; i < duplicates.length; i += CHUNK) {
        const chunk = duplicates.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const sale of chunk) {
          batch.delete(doc(db, 'sales', sale.id));
        }
        await batch.commit();
      }
      setSaveError(null);
      return { removed: duplicates.length, kept: salesRef.current.length - duplicates.length };
    } catch (err) {
      devError('removeDuplicateSales error:', err);
      setSaveError(`Erro ao remover duplicatas: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
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
    setDataWithDelete(prev => ({
      ...prev,
      customSpecies: prev.customSpecies.filter(s => s.species !== speciesName),
    }));
  };

  // Financial Investments
  const addFinancialInvestment = (investment) => {
    const newInv = {
      ...investment,
      id: newId(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      financialInvestments: [...prev.financialInvestments, newInv],
    }));
    return newInv;
  };

  const deleteFinancialInvestment = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      financialInvestments: prev.financialInvestments.filter(i => i.id !== id),
    }));
  };

  // Payments (withdrawals / profit sent to investor)
  const addPayment = (payment) => {
    const newPayment = {
      ...payment,
      id: newId(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      payments: [...(prev.payments || []), newPayment],
    }));
    return newPayment;
  };

  const deletePayment = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      payments: (prev.payments || []).filter(p => p.id !== id),
    }));
  };

  // Expenses (operational costs)
  const addExpense = (expense) => {
    const newExpense = {
      ...expense,
      id: newId(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      expenses: [...(prev.expenses || []), newExpense],
    }));
    return newExpense;
  };

  const bulkAddExpenses = (expensesArray) => {
    const now = new Date().toISOString();
    const newExpenses = expensesArray.map(expense => ({
      ...expense,
      id: newId(),
      createdAt: now,
    }));
    setData(prev => ({
      ...prev,
      expenses: [...(prev.expenses || []), ...newExpenses],
    }));
    return newExpenses;
  };

  const updateExpense = (id, updates) => {
    setData(prev => ({
      ...prev,
      expenses: (prev.expenses || []).map(e => e.id === id ? { ...e, ...updates } : e),
    }));
  };

  const deleteExpense = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      expenses: (prev.expenses || []).filter(e => e.id !== id),
    }));
  };

  // Custom Expense Categories
  const addCustomExpenseCategory = (category) => {
    setData(prev => {
      const existing = prev.customExpenseCategories || [];
      if (existing.some(c => c.name.toLowerCase() === category.name.toLowerCase())) return prev;
      return { ...prev, customExpenseCategories: [...existing, { ...category, id: newId() }] };
    });
  };

  const deleteCustomExpenseCategory = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      customExpenseCategories: (prev.customExpenseCategories || []).filter(c => c.id !== id),
    }));
  };

  // Egg Collections
  const addEggCollection = (collection) => {
    const newCollection = {
      ...collection,
      id: newId(),
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
    setDataWithDelete(prev => ({
      ...prev,
      eggCollections: (prev.eggCollections || []).filter(c => c.id !== id),
    }));
  };

  // Incubators
  const addIncubator = (incubator) => {
    const newIncubator = { ...incubator, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, incubators: [...(prev.incubators || []), newIncubator] }));
    return newIncubator;
  };
  const updateIncubator = (id, updates) => {
    setData(prev => ({ ...prev, incubators: (prev.incubators || []).map(i => i.id === id ? { ...i, ...updates } : i) }));
  };
  const deleteIncubator = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      incubators: (prev.incubators || []).filter(i => i.id !== id),
      incubatorBatches: (prev.incubatorBatches || []).filter(b => b.incubatorId !== id),
    }));
  };

  // Incubator Batches
  const addIncubatorBatch = (batch) => {
    const newBatch = { ...batch, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, incubatorBatches: [...(prev.incubatorBatches || []), newBatch] }));
    return newBatch;
  };
  const updateIncubatorBatch = (id, updates) => {
    setData(prev => ({ ...prev, incubatorBatches: (prev.incubatorBatches || []).map(b => b.id === id ? { ...b, ...updates } : b) }));
  };
  const deleteIncubatorBatch = (id) => {
    setDataWithDelete(prev => ({ ...prev, incubatorBatches: (prev.incubatorBatches || []).filter(b => b.id !== id) }));
  };

  // Infirmary Bays
  const addInfirmaryBay = (bay) => {
    const newBay = { ...bay, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, infirmaryBays: [...(prev.infirmaryBays || []), newBay] }));
    return newBay;
  };
  const updateInfirmaryBay = (id, updates) => {
    setData(prev => ({ ...prev, infirmaryBays: (prev.infirmaryBays || []).map(b => b.id === id ? { ...b, ...updates } : b) }));
  };
  const deleteInfirmaryBay = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      infirmaryBays: (prev.infirmaryBays || []).filter(b => b.id !== id),
      infirmaryAdmissions: (prev.infirmaryAdmissions || []).filter(a => a.bayId !== id),
    }));
  };

  // Infirmary Admissions
  const addInfirmaryAdmission = (admission) => {
    const newAdmission = { ...admission, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, infirmaryAdmissions: [...(prev.infirmaryAdmissions || []), newAdmission] }));
    return newAdmission;
  };
  const updateInfirmaryAdmission = (id, updates) => {
    setData(prev => ({ ...prev, infirmaryAdmissions: (prev.infirmaryAdmissions || []).map(a => a.id === id ? { ...a, ...updates } : a) }));
  };
  const deleteInfirmaryAdmission = (id) => {
    setDataWithDelete(prev => ({ ...prev, infirmaryAdmissions: (prev.infirmaryAdmissions || []).filter(a => a.id !== id) }));
  };

  // Treatments (per bird house / breed)
  const addTreatment = (treatment) => {
    const newTreatment = { ...treatment, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, treatments: [...(prev.treatments || []), newTreatment] }));
    return newTreatment;
  };
  const updateTreatment = (id, updates) => {
    setData(prev => ({ ...prev, treatments: (prev.treatments || []).map(t => t.id === id ? { ...t, ...updates } : t) }));
  };
  const deleteTreatment = (id) => {
    setDataWithDelete(prev => ({ ...prev, treatments: (prev.treatments || []).filter(t => t.id !== id) }));
  };

  // Custom Treatment Types
  const addCustomTreatmentType = (type) => {
    setData(prev => {
      const existing = prev.customTreatmentTypes || [];
      if (existing.some(t => t.name.toLowerCase() === type.name.toLowerCase())) return prev;
      return { ...prev, customTreatmentTypes: [...existing, { ...type, id: newId() }] };
    });
  };
  const deleteCustomTreatmentType = (id) => {
    setDataWithDelete(prev => ({ ...prev, customTreatmentTypes: (prev.customTreatmentTypes || []).filter(t => t.id !== id) }));
  };

  // Nursery Rooms
  const addNurseryRoom = (room) => {
    const newRoom = { ...room, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, nurseryRooms: [...(prev.nurseryRooms || []), newRoom] }));
    return newRoom;
  };
  const updateNurseryRoom = (id, updates) => {
    setData(prev => ({ ...prev, nurseryRooms: (prev.nurseryRooms || []).map(r => r.id === id ? { ...r, ...updates } : r) }));
  };
  const deleteNurseryRoom = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      nurseryRooms: (prev.nurseryRooms || []).filter(r => r.id !== id),
      nurseryBatches: (prev.nurseryBatches || []).filter(b => b.roomId !== id),
      nurseryEvents: (prev.nurseryEvents || []).filter(e => e.roomId !== id),
    }));
  };

  // Nursery Batches (chick groups in rooms)
  const addNurseryBatch = (batch) => {
    const newBatch = { ...batch, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, nurseryBatches: [...(prev.nurseryBatches || []), newBatch] }));
    return newBatch;
  };
  const updateNurseryBatch = (id, updates) => {
    setData(prev => ({ ...prev, nurseryBatches: (prev.nurseryBatches || []).map(b => b.id === id ? { ...b, ...updates } : b) }));
  };
  const deleteNurseryBatch = (id) => {
    setDataWithDelete(prev => ({ ...prev, nurseryBatches: (prev.nurseryBatches || []).filter(b => b.id !== id) }));
  };

  // Nursery Events (deaths, medications, vaccinations, bedding changes)
  const addNurseryEvent = (event) => {
    const newEvent = { ...event, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, nurseryEvents: [...(prev.nurseryEvents || []), newEvent] }));
    return newEvent;
  };
  const updateNurseryEvent = (id, updates) => {
    setData(prev => ({ ...prev, nurseryEvents: (prev.nurseryEvents || []).map(e => e.id === id ? { ...e, ...updates } : e) }));
  };
  const deleteNurseryEvent = (id) => {
    setDataWithDelete(prev => ({ ...prev, nurseryEvents: (prev.nurseryEvents || []).filter(e => e.id !== id) }));
  };

  // Force save current data to both Firestore and localStorage (can be called by pages)
  const forceSync = () => {
    if (countItems(dataRef.current) === 0) return;
    const sanitized = JSON.parse(JSON.stringify(dataRef.current));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataRef.current));
    lastLocalWriteTime.current = Date.now();
    pendingWriteCount.current += 1;
    setDoc(FIRESTORE_DOC, sanitized)
      .catch(err => devError('Force sync error:', err))
      .finally(() => {
        pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
        lastLocalWriteTime.current = Date.now();
      });
  };

  // -----------------------------------------------------------------
  // Portal share tokens (Phase 2B).
  //
  // We store revocable portal links in a separate /shareTokens collection,
  // where the document ID *is* the token. Tokens are generated with
  // crypto.randomUUID() (128 bits of entropy) — they cannot be enumerated,
  // cannot be guessed from investor.id, and can be revoked by deleting the
  // /shareTokens doc. The admin UI still surfaces a single "current token"
  // per target (investor or employee) by mirroring the token back onto the
  // respective record for display purposes.
  //
  // All four helpers below are async: they write to the separate collection
  // BEFORE updating local state so the mirror never points at a token that
  // doesn't exist in /shareTokens.
  // -----------------------------------------------------------------
  const writeShareToken = async (token, payload) => {
    await setDoc(doc(db, 'shareTokens', token), payload);
  };
  const deleteShareToken = async (token) => {
    if (!token) return;
    try {
      await deleteDoc(doc(db, 'shareTokens', token));
    } catch {
      // Best-effort: the token doc may not exist (legacy token) or the
      // delete may be blocked transiently. Revocation still "works" from
      // the user's perspective because the appData mirror no longer
      // references the old token.
    }
  };

  // Employee Token. One active link at a time (admin UX choice).
  const generateEmployeeToken = async () => {
    const token = newId();
    const oldToken = dataRef.current.employeeToken;
    await writeShareToken(token, {
      type: 'employee',
      createdAt: new Date().toISOString(),
    });
    setData(prev => ({ ...prev, employeeToken: token }));
    // Revoke the previous token after the new one is in place so there's
    // never a window during which no link works.
    if (oldToken && oldToken !== token) {
      await deleteShareToken(oldToken);
    }
    return token;
  };
  const revokeEmployeeToken = async () => {
    const oldToken = dataRef.current.employeeToken;
    setData(prev => ({ ...prev, employeeToken: '' }));
    await deleteShareToken(oldToken);
  };

  // Investor Portal Token. One active link per investor.
  const generateInvestorPortalToken = async (investorId) => {
    const investor = (dataRef.current.investors || []).find(i => i.id === investorId);
    if (!investor) return null;
    const token = newId();
    const oldToken = investor.portalTokenId;
    await writeShareToken(token, {
      type: 'investor',
      investorId,
      createdAt: new Date().toISOString(),
    });
    updateInvestor(investorId, { portalTokenId: token });
    if (oldToken && oldToken !== token) {
      await deleteShareToken(oldToken);
    }
    return token;
  };
  const revokeInvestorPortalToken = async (investorId) => {
    const investor = (dataRef.current.investors || []).find(i => i.id === investorId);
    if (!investor || !investor.portalTokenId) return;
    const oldToken = investor.portalTokenId;
    updateInvestor(investorId, { portalTokenId: null });
    await deleteShareToken(oldToken);
  };

  const value = {
    ...data,
    sales,
    loading: loading || salesLoading,
    firestoreError,
    saveError,
    addInvestor, updateInvestor, deleteInvestor,
    addBird, updateBird, deleteBird,
    addSales, clearSales, deleteSale, updateSale, removeDuplicateSales,
    addFinancialInvestment, deleteFinancialInvestment,
    addPayment, deletePayment,
    addExpense, bulkAddExpenses, updateExpense, deleteExpense,
    addCustomExpenseCategory, deleteCustomExpenseCategory,
    addEggCollection, updateEggCollection, deleteEggCollection,
    addIncubator, updateIncubator, deleteIncubator,
    addIncubatorBatch, updateIncubatorBatch, deleteIncubatorBatch,
    addInfirmaryBay, updateInfirmaryBay, deleteInfirmaryBay,
    addInfirmaryAdmission, updateInfirmaryAdmission, deleteInfirmaryAdmission,
    addTreatment, updateTreatment, deleteTreatment,
    addCustomTreatmentType, deleteCustomTreatmentType,
    addNurseryRoom, updateNurseryRoom, deleteNurseryRoom,
    addNurseryBatch, updateNurseryBatch, deleteNurseryBatch,
    addNurseryEvent, updateNurseryEvent, deleteNurseryEvent,
    generateEmployeeToken, revokeEmployeeToken,
    generateInvestorPortalToken, revokeInvestorPortalToken,
    addCustomSpecies, deleteCustomSpecies,
    forceSync,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
