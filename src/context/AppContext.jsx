import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

const AppContext = createContext();

const STORAGE_KEY = 'sitio_voo_dos_gansos_data';
const FIRESTORE_DOC = doc(db, 'config', 'appData');

const defaultData = {
  investors: [],
  birds: [],
  sales: [],
  financialInvestments: [],
  customSpecies: [],
};

// Sample bird species/breeds
export const BIRD_SPECIES = [
  { species: 'Galinha', breeds: ['Brahma Splash', 'Brahma Black', 'Brahma Light', 'Brahma Perdiz', 'Brahma Blue', 'Sebright Dourada', 'Sebright Prata', 'Cochinchina Amarela', 'Cochinchina Preta', 'Orpington Amarela', 'Orpington Blue', 'Sussexs', 'Plymouth Rock', 'Wyandotte Prata', 'Wyandotte Dourada', 'Silkie Branca', 'Silkie Preta', 'Polonesa Dourada', 'Polonesa Prata'] },
  { species: 'Faisão', breeds: ['Coleira', 'Dourado', 'Lady Amherst', 'Prateado', 'Canário', 'Venerado', 'Elliot'] },
  { species: 'Pavão', breeds: ['Azul', 'Branco', 'Arlequim', 'Negro', 'Cameo'] },
  { species: 'Pato', breeds: ['Carolina', 'Mandarim', 'Rouen', 'Muscovy', 'Cayuga', 'Runner Indiano'] },
  { species: 'Marreco', breeds: ['Mallard', 'Call Duck Branco', 'Call Duck Cinza', 'Rouen'] },
  { species: 'Peru', breeds: ['Bronze', 'Branco', 'Bourbon Red', 'Narragansett', 'Royal Palm'] },
  { species: 'Ganso', breeds: ['Toulouse', 'Africano', 'Chinês Branco', 'Chinês Pardo', 'Embden'] },
  { species: 'Codorna', breeds: ['Chinesa', 'Japonesa', 'Bobwhite', 'Califórnia'] },
];

export function AppProvider({ children }) {
  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(true);
  const isFromFirestore = useRef(false);

  // Listen to Firestore in real-time
  useEffect(() => {
    const unsubscribe = onSnapshot(FIRESTORE_DOC, (snapshot) => {
      if (snapshot.exists()) {
        isFromFirestore.current = true;
        setData({ ...defaultData, ...snapshot.data() });
      } else {
        // First time: try to migrate from localStorage
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const parsed = { ...defaultData, ...JSON.parse(stored) };
            setDoc(FIRESTORE_DOC, parsed);
            isFromFirestore.current = true;
            setData(parsed);
          }
        } catch {
          // ignore
        }
      }
      setLoading(false);
    }, (error) => {
      console.error('Firestore error:', error);
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

  // Save to Firestore when data changes (skip if change came from Firestore itself)
  useEffect(() => {
    if (loading) return;
    if (isFromFirestore.current) {
      isFromFirestore.current = false;
      return;
    }
    // Save to both Firestore and localStorage (backup)
    setDoc(FIRESTORE_DOC, data).catch(err => console.error('Firestore save error:', err));
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
      const existing = prev.customSpecies.find(s => s.species === speciesData.species);
      if (existing) {
        // Add new breeds to existing species
        const newBreeds = speciesData.breeds.filter(b => !existing.breeds.includes(b));
        if (newBreeds.length === 0) return prev;
        return {
          ...prev,
          customSpecies: prev.customSpecies.map(s =>
            s.species === speciesData.species
              ? { ...s, breeds: [...s.breeds, ...newBreeds] }
              : s
          ),
        };
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

  const value = {
    ...data,
    loading,
    addInvestor, updateInvestor, deleteInvestor,
    addBird, updateBird, deleteBird,
    addSales, clearSales, deleteSale, updateSale,
    addFinancialInvestment, deleteFinancialInvestment,
    addCustomSpecies, deleteCustomSpecies,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
