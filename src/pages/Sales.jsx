import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, formatPercent, calculateProfitDistribution,
  isEggProduct, getEggProfitRate, getBirdProfitRate, filterValidTransactions, matchSaleToBird,
  resolveBirdInvestorForDate, getSaleRateInfo, resolveRateFor
} from '../utils/helpers';
import { MULTIPLICADOR_AVE_PADRAO, getMultiplicadorAve } from '../utils/ordens';
import { parseCSV, readFileAsText } from '../utils/csvParser';
import { parseWixOrderText } from '../utils/pdfParser';
import {
  Upload, Trash2, CheckCircle, AlertCircle, ShoppingCart,
  FileText, ClipboardPaste, PlusCircle, X, Edit2, Save, Copy, RefreshCw, UserCheck, Percent
} from 'lucide-react';

const EMPTY_MANUAL_ITEM = { itemDescription: '', quantity: 1, price: '' };
const EMPTY_AVULSA = {
  investorId: '', itemDescription: '', type: 'egg',
  quantity: 1, totalValue: '', date: '', buyerName: '',
};

export default function Sales() {
  const {
    investors, birds, sales,
    addSales, clearSales, deleteSale, updateSale, removeDuplicateSales, recoverLegacySales, forceReloadSales,
    eggProfitRate, birdProfitRate, precoOvoReferencia, comissaoConfig,
    updateProfitRates, recalculateAllSaleProfits,
  } = useApp();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dedupeRunning, setDedupeRunning] = useState(false);
  const [dedupeResult, setDedupeResult] = useState(null);
  const [recoverRunning, setRecoverRunning] = useState(false);
  const [recoverResult, setRecoverResult] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [importTab, setImportTab] = useState('file'); // file | paste | manual | avulsa
  const [pasteText, setPasteText] = useState('');
  const [manualOrder, setManualOrder] = useState({ orderNumber: '', buyerName: '', date: '', items: [{ ...EMPTY_MANUAL_ITEM }] });
  const [avulsaForm, setAvulsaForm] = useState({ ...EMPTY_AVULSA });
  const [editingSale, setEditingSale] = useState(null);
  const [sortField, setSortField] = useState('date'); // date | totalValue | orderNumber
  const [sortDir, setSortDir] = useState('desc'); // asc | desc
  const [currentPage, setCurrentPage] = useState(1);
  // Profit-rate configuration modal. Two steps: edit the values, then choose
  // whether the change applies only going forward or reprices the history.
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [ratesForm, setRatesForm] = useState({ egg: '', bird: '', precoOvo: '', multiplicador: '' });
  const [ratesPending, setRatesPending] = useState(null);
  const [ratesSaving, setRatesSaving] = useState(false);
  const [ratesResult, setRatesResult] = useState(null);
  const ITEMS_PER_PAGE = 50;
  const fileInputRef = useRef(null);

  // Configured global rates. Existing sales keep whatever rate they were
  // registered with; these two only apply to sales created from now on.
  const rates = useMemo(
    () => ({ eggProfitRate, birdProfitRate }),
    [eggProfitRate, birdProfitRate]
  );
  const eggRate = getEggProfitRate(rates);
  const birdRate = getBirdProfitRate(rates);

  // Lookup so each row can resolve the rate of the animal it is linked to.
  const birdById = useMemo(() => {
    const map = {};
    birds.forEach(b => { map[b.id] = b; });
    return map;
  }, [birds]);

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds, rates),
    [sales, birds, rates]
  );

  const validSales = useMemo(() => filterValidTransactions(sales), [sales]);

  // Process parsed rows (from CSV or PDF) into sales with profit distribution.
  // Now async because addSales writes directly to the /sales collection in
  // batches of 400 — a large CSV can take a few seconds to flush. Callers
  // must await before clearing importing state.
  const processAndAddSales = async (parsed) => {
    const valid = parsed.filter(row => {
      const status = (row.transactionStatus || '').toUpperCase();
      return !status.includes('RECUSAD') && !status.includes('REEMBOLSAD');
    });

    const rejected = parsed.length - valid.length;

    const processedSales = valid.map(row => {
      const description = row.itemDescription || row.item || '';
      const totalValue = parseFloat(row.totalValue || row.price || 0);
      const isEgg = isEggProduct(description);

      // Credit the investor who owned the bird ON THE SALE DATE, so imports
      // that span an ownership transfer land on the right person.
      const matchedBird = matchSaleToBird(description, birds);
      const matchedBirdId = matchedBird ? matchedBird.id : null;
      const matchedInvestorId = matchedBird ? resolveBirdInvestorForDate(matchedBird, row.date) : null;
      const matchedBreed = matchedBird ? matchedBird.breed : null;

      // The matched animal may carry its own rate; otherwise the global one.
      const rate = resolveRateFor(matchedBird, isEgg, rates);

      return {
        ...row,
        itemDescription: description,
        totalValue,
        isEgg,
        profitRate: rate,
        profit: totalValue * rate,
        matchedBirdId,
        matchedInvestorId,
        matchedBreed,
      };
    });

    await addSales(processedSales);

    const matched = processedSales.filter(s => s.matchedInvestorId).length;
    const unmatched = processedSales.length - matched;

    return {
      success: true,
      total: parsed.length,
      valid: valid.length,
      rejected,
      matched,
      unmatched,
      totalValue: processedSales.reduce((s, p) => s + p.totalValue, 0),
      totalProfit: processedSales.filter(s => s.matchedInvestorId).reduce((s, p) => s + p.profit, 0),
    };
  };

  // FILE UPLOAD
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    try {
      const text = await readFileAsText(file);
      const parsed = await parseCSV(text);
      const result = await processAndAddSales(parsed);
      result.source = 'CSV';
      setImportResult(result);
    } catch (err) {
      setImportResult({ success: false, error: err.message });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // PASTE TEXT (supports multiple orders, up to 50 at once)
  const handlePasteImport = async () => {
    if (!pasteText.trim()) return;

    setImporting(true);
    setImportResult(null);

    try {
      const pdfData = parseWixOrderText(pasteText);
      if (!pdfData.items || pdfData.items.length === 0) {
        throw new Error('Nenhum item encontrado no texto colado. Verifique o formato do recibo.');
      }
      const result = await processAndAddSales(pdfData.items);
      result.source = pdfData.multipleOrders ? `Texto (${pdfData.orderCount} pedidos)` : 'Texto';
      result.orderNumber = pdfData.orderNumber;
      result.buyerName = pdfData.buyerName;
      if (pdfData.multipleOrders) {
        result.orderCount = pdfData.orderCount;
        result.orderSummary = pdfData.orderSummary;
      }
      setImportResult(result);
      setPasteText('');
    } catch (err) {
      setImportResult({ success: false, error: err.message });
    } finally {
      setImporting(false);
    }
  };

  // MANUAL ENTRY
  const addManualItem = () => {
    setManualOrder(prev => ({
      ...prev,
      items: [...prev.items, { ...EMPTY_MANUAL_ITEM }],
    }));
  };

  const removeManualItem = (index) => {
    setManualOrder(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const updateManualItem = (index, field, value) => {
    setManualOrder(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === index ? { ...item, [field]: value } : item),
    }));
  };

  const handleManualSubmit = async () => {
    const validItems = manualOrder.items.filter(item =>
      item.itemDescription.trim() && parseFloat(item.price) > 0
    );

    if (validItems.length === 0) {
      setImportResult({ success: false, error: 'Adicione pelo menos um item com descricao e preco.' });
      return;
    }

    setImportResult(null);
    setImporting(true);

    const parsed = validItems.map(item => {
      const qty = parseInt(item.quantity, 10) || 1;
      const unitPrice = parseFloat(item.price) || 0;
      return {
        orderNumber: manualOrder.orderNumber,
        buyerName: manualOrder.buyerName,
        date: manualOrder.date || new Date().toISOString().slice(0, 10),
        itemDescription: item.itemDescription.trim(),
        price: unitPrice,
        quantity: qty,
        totalValue: unitPrice * qty,
        transactionStatus: 'Pago',
      };
    });

    try {
      const result = await processAndAddSales(parsed);
      result.source = 'Manual';
      setImportResult(result);
      setManualOrder({ orderNumber: '', buyerName: '', date: '', items: [{ ...EMPTY_MANUAL_ITEM }] });
    } catch (err) {
      setImportResult({ success: false, error: err.message });
    } finally {
      setImporting(false);
    }
  };

  // STANDALONE / "AVULSA" SALE
  //
  // Creates a single sale addressed directly to a chosen investor, with no
  // bird linked. Unlike the other import paths, this does NOT run the
  // breed-matching logic — the investor is set explicitly and the sale is
  // flagged isManual so the edit flow and profit distribution preserve the
  // chosen investor and rate.
  const handleAvulsaSubmit = async () => {
    const investorId = avulsaForm.investorId;
    const description = avulsaForm.itemDescription.trim();
    const totalValue = parseFloat(avulsaForm.totalValue) || 0;

    if (!investorId) {
      setImportResult({ success: false, error: 'Selecione um investidor para a venda avulsa.' });
      return;
    }
    if (!description) {
      setImportResult({ success: false, error: 'Informe a descricao do item avulso.' });
      return;
    }
    if (totalValue <= 0) {
      setImportResult({ success: false, error: 'Informe um valor maior que zero.' });
      return;
    }

    const isEgg = avulsaForm.type === 'egg';
    const rate = isEgg ? eggRate : birdRate;
    const qty = parseInt(avulsaForm.quantity, 10) || 1;
    const investor = investors.find(i => i.id === investorId);

    const sale = {
      orderNumber: '',
      buyerName: avulsaForm.buyerName.trim() || (investor ? investor.name : ''),
      date: avulsaForm.date || new Date().toISOString().slice(0, 10),
      itemDescription: description,
      quantity: qty,
      price: totalValue,
      totalValue,
      transactionStatus: 'Pago',
      isEgg,
      profitRate: rate,
      profit: totalValue * rate,
      matchedBirdId: null,
      matchedInvestorId: investorId,
      matchedBreed: null,
      isManual: true,
    };

    setImportResult(null);
    setImporting(true);
    try {
      await addSales([sale]);
      setImportResult({
        success: true, source: 'Avulsa', total: 1, valid: 1, rejected: 0,
        matched: 1, unmatched: 0, totalValue, totalProfit: totalValue * rate,
      });
      setAvulsaForm({ ...EMPTY_AVULSA });
    } catch (err) {
      setImportResult({ success: false, error: err.message });
    } finally {
      setImporting(false);
    }
  };

  // Run the dedupe helper from AppContext, which finds sales with the same
  // (orderNumber + itemDescription + totalValue + quantity) and deletes all
  // but the oldest occurrence.
  const handleRemoveDuplicates = async () => {
    if (dedupeRunning) return;
    if (!window.confirm(
      'Remover vendas duplicadas? Isso apaga itens com mesmo numero de pedido, descricao, valor e quantidade. A copia mais antiga de cada grupo e mantida.'
    )) return;
    setDedupeRunning(true);
    setDedupeResult(null);
    try {
      const result = await removeDuplicateSales();
      setDedupeResult(result);
    } catch (err) {
      setDedupeResult({ error: err?.message || 'Erro ao remover duplicatas' });
    } finally {
      setDedupeRunning(false);
    }
  };

  const handleRecoverSales = async () => {
    if (recoverRunning) return;
    setRecoverRunning(true);
    setRecoverResult(null);
    try {
      const result = await recoverLegacySales();
      setRecoverResult(result);
    } catch (err) {
      setRecoverResult({ status: 'error', message: err?.message || 'Erro ao recuperar vendas' });
    } finally {
      setRecoverRunning(false);
    }
  };

  const filteredSales = useMemo(() => {
    let list = validSales;
    if (filterType === 'eggs') list = list.filter(s => s.isEgg);
    if (filterType === 'birds') list = list.filter(s => !s.isEgg);
    if (filterType === 'matched') list = list.filter(s => s.matchedInvestorId);
    if (filterType === 'unmatched') list = list.filter(s => !s.matchedInvestorId);

    // Sort
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') {
        cmp = (a.date || '').localeCompare(b.date || '');
      } else if (sortField === 'totalValue') {
        cmp = (parseFloat(a.totalValue) || 0) - (parseFloat(b.totalValue) || 0);
      } else if (sortField === 'orderNumber') {
        cmp = (parseInt(a.orderNumber) || 0) - (parseInt(b.orderNumber) || 0);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [validSales, filterType, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / ITEMS_PER_PAGE));
  const paginatedSales = filteredSales.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const toggleSort = (field) => {
    setCurrentPage(1);
    if (sortField === field) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortIndicator = (field) => {
    if (sortField !== field) return '';
    return sortDir === 'desc' ? ' ▼' : ' ▲';
  };

  const getInvestorName = (id) => investors.find(i => i.id === id)?.name || '-';

  // ---- Profit rate configuration --------------------------------------
  const rateToInput = (rate) =>
    String(((Number(rate) || 0) * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));

  const openRatesModal = () => {
    setRatesForm({ egg: rateToInput(eggRate), bird: rateToInput(birdRate) });
    setRatesPending(null);
    setRatesResult(null);
    setShowRatesModal(true);
  };

  const closeRatesModal = () => {
    if (ratesSaving) return;
    setShowRatesModal(false);
    setRatesPending(null);
    setRatesResult(null);
  };

  // Step 1 -> 2: validate the typed percentages and ask about the scope.
  const handleRatesContinue = (e) => {
    e.preventDefault();
    const egg = parseFloat(String(ratesForm.egg).replace(',', '.'));
    const bird = parseFloat(String(ratesForm.bird).replace(',', '.'));
    if (!isFinite(egg) || egg < 0 || egg > 100 || !isFinite(bird) || bird < 0 || bird > 100) {
      setRatesResult({ error: 'Informe porcentagens validas entre 0 e 100.' });
      return;
    }
    // Preco geral do ovo: opcional. Vazio quer dizer "cada lote se vira com o
    // proprio preco ou com o historico de venda dele"; preenchido, e a rede de
    // seguranca que impede uma venda de ave de cair fora da fila.
    const precoTexto = String(ratesForm.precoOvo).trim().replace(',', '.');
    const preco = precoTexto ? parseFloat(precoTexto) : null;
    if (precoTexto && (!isFinite(preco) || preco <= 0)) {
      setRatesResult({ error: 'O preco geral do ovo precisa ser um valor maior que zero.' });
      return;
    }
    const multTexto = String(ratesForm.multiplicador).trim().replace(',', '.');
    const mult = multTexto ? parseFloat(multTexto) : MULTIPLICADOR_AVE_PADRAO;
    if (!isFinite(mult) || mult <= 0) {
      setRatesResult({ error: 'Uma ave tem que valer mais que zero ovos.' });
      return;
    }
    setRatesResult(null);
    setRatesPending({
      eggProfitRate: egg / 100,
      birdProfitRate: bird / 100,
      precoOvoReferencia: preco,
      multiplicadorAve: mult,
    });
  };

  // Step 2: apply. `recalculate` reprices every stored sale (irreversible).
  const applyRates = async (recalculate) => {
    if (!ratesPending || ratesSaving) return;
    if (recalculate && !window.confirm(
      'Recalcular TODAS as vendas ja registradas com as novas taxas? '
      + 'Os lucros e saldos de todos os investidores serao alterados. Esta acao nao pode ser desfeita.'
    )) return;

    setRatesSaving(true);
    try {
      updateProfitRates(ratesPending);
      if (recalculate) {
        const res = await recalculateAllSaleProfits(ratesPending);
        setRatesResult({ ok: `Taxas salvas e ${res.updated} venda(s) recalculada(s).` });
      } else {
        setRatesResult({ ok: 'Taxas salvas. As vendas ja registradas mantiveram as taxas antigas.' });
      }
      setRatesPending(null);
      setTimeout(() => setShowRatesModal(false), 1800);
    } catch (err) {
      setRatesResult({ error: err?.message || 'Erro ao aplicar as taxas.' });
    } finally {
      setRatesSaving(false);
    }
  };

  const handleDeleteSale = async (sale) => {
    if (window.confirm(`Excluir venda "${sale.itemDescription || sale.item || 'sem descricao'}"?`)) {
      try {
        await deleteSale(sale.id);
      } catch {
        // saveError banner in the shell already surfaces the reason.
      }
    }
  };

  const handleStartEdit = (sale) => {
    setEditingSale({
      id: sale.id,
      itemDescription: sale.itemDescription || sale.item || '',
      quantity: sale.quantity || 1,
      totalValue: sale.totalValue || 0,
      date: sale.date ? sale.date.slice(0, 10) : '',
      orderNumber: sale.orderNumber || '',
      isManual: !!sale.isManual,
      matchedInvestorId: sale.matchedInvestorId || '',
      type: sale.isEgg ? 'egg' : 'bird',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingSale) return;
    const description = editingSale.itemDescription;
    const totalValue = parseFloat(editingSale.totalValue) || 0;

    let updates;
    if (editingSale.isManual) {
      // Standalone sale: keep the investor chosen by the admin and the
      // explicit Ovo/Ave type. Do NOT re-run breed matching, which would
      // wipe the manual link for custom item descriptions.
      const isEgg = editingSale.type === 'egg';
      const rate = isEgg ? eggRate : birdRate;
      updates = {
        itemDescription: description,
        quantity: parseInt(editingSale.quantity, 10) || 1,
        totalValue,
        date: editingSale.date,
        orderNumber: editingSale.orderNumber,
        isEgg,
        profitRate: rate,
        profit: totalValue * rate,
        matchedBirdId: null,
        matchedInvestorId: editingSale.matchedInvestorId || null,
        matchedBreed: null,
        isManual: true,
      };
    } else {
      // Imported sale: recompute type and re-link to a bird/investor by breed.
      const isEgg = isEggProduct(description);
      const matchedBird = matchSaleToBird(description, birds);
      const rate = resolveRateFor(matchedBird, isEgg, rates);
      updates = {
        itemDescription: description,
        quantity: parseInt(editingSale.quantity, 10) || 1,
        totalValue,
        date: editingSale.date,
        orderNumber: editingSale.orderNumber,
        isEgg,
        profitRate: rate,
        profit: totalValue * rate,
        matchedBirdId: matchedBird ? matchedBird.id : null,
        matchedInvestorId: matchedBird ? resolveBirdInvestorForDate(matchedBird, editingSale.date) : null,
        matchedBreed: matchedBird ? matchedBird.breed : null,
      };
    }

    try {
      await updateSale(editingSale.id, updates);
      setEditingSale(null);
    } catch {
      // saveError banner shows the reason; keep the modal open so the
      // admin can retry without losing what they typed.
    }
  };

  return (
    <div className="animate-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2>Vendas</h2>
          <p>Importe vendas do Wix (CSV, texto colado ou manual) e distribua lucros</p>
        </div>
        <button className="btn btn-secondary" onClick={openRatesModal} style={{ whiteSpace: 'nowrap' }}>
          <Percent size={14} /> Taxas Gerais ({formatPercent(eggRate)} / {formatPercent(birdRate)})
        </button>
      </div>

      {/* Import Area */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">Importar Vendas</span>
          {sales.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={handleRemoveDuplicates}
                disabled={dedupeRunning}
                title="Remover vendas duplicadas (mesmo pedido + item + valor + qtd)"
              >
                <Copy size={14} /> {dedupeRunning ? 'Removendo...' : 'Remover Duplicados'}
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={async () => {
                  setRecoverRunning(true);
                  setRecoverResult(null);
                  try {
                    const result = await forceReloadSales();
                    setRecoverResult(result);
                  } catch (err) {
                    setRecoverResult({ status: 'error', message: err?.message || 'Erro' });
                  } finally {
                    setRecoverRunning(false);
                  }
                }}
                disabled={recoverRunning}
                title="Forcar releitura da colecao /sales do Firestore"
                style={{ color: 'var(--primary)' }}
              >
                <RefreshCw size={14} /> Recarregar Vendas
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={handleRecoverSales}
                disabled={recoverRunning}
                title="Recuperar vendas de fontes alternativas (appData, localStorage)"
                style={{ color: 'var(--warning)' }}
              >
                <AlertCircle size={14} /> {recoverRunning ? 'Verificando...' : 'Recuperar Vendas'}
              </button>
              <button
                className="btn btn-sm btn-secondary"
                style={{ color: 'var(--danger)' }}
                onClick={async () => {
                  if (window.confirm('Limpar todas as vendas importadas?')) {
                    try {
                      await clearSales();
                    } catch {
                      // saveError banner surfaces the reason
                    }
                  }
                }}
              >
                <Trash2 size={14} /> Limpar Vendas
              </button>
            </div>
          )}
        </div>

        {dedupeResult && (
          <div style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 'var(--radius-sm)',
            background: dedupeResult.error ? 'var(--danger-bg)' : 'var(--success-bg)',
            color: dedupeResult.error ? 'var(--danger)' : 'var(--success)',
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
          }}>
            {dedupeResult.error ? (
              <>
                <AlertCircle size={18} /> <span>{dedupeResult.error}</span>
              </>
            ) : (
              <>
                <CheckCircle size={18} />
                <span>
                  {dedupeResult.removed === 0
                    ? 'Nenhuma venda duplicada encontrada.'
                    : `${dedupeResult.removed} venda${dedupeResult.removed === 1 ? '' : 's'} duplicada${dedupeResult.removed === 1 ? '' : 's'} removida${dedupeResult.removed === 1 ? '' : 's'}. ${dedupeResult.kept} venda${dedupeResult.kept === 1 ? '' : 's'} mantida${dedupeResult.kept === 1 ? '' : 's'}.`}
                </span>
                <button
                  className="btn btn-sm btn-secondary"
                  style={{ marginLeft: 'auto', padding: '2px 6px' }}
                  onClick={() => setDedupeResult(null)}
                  title="Fechar"
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        )}

        {recoverResult && (
          <div style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 'var(--radius-sm)',
            background: recoverResult.status === 'error' ? 'var(--danger-bg)' : recoverResult.status === 'recovered' ? 'var(--success-bg)' : 'var(--primary-bg)',
            color: recoverResult.status === 'error' ? 'var(--danger)' : recoverResult.status === 'recovered' ? 'var(--success)' : 'var(--primary)',
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
          }}>
            {recoverResult.status === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
            <span>{recoverResult.message}</span>
            <button
              className="btn btn-sm btn-secondary"
              style={{ marginLeft: 'auto', padding: '2px 6px' }}
              onClick={() => setRecoverResult(null)}
              title="Fechar"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Import Method Tabs */}
        <div className="tabs" style={{ marginBottom: 16 }}>
          <button className={`tab ${importTab === 'file' ? 'active' : ''}`} onClick={() => setImportTab('file')}>
            <Upload size={14} /> Arquivo CSV
          </button>
          <button className={`tab ${importTab === 'paste' ? 'active' : ''}`} onClick={() => setImportTab('paste')}>
            <ClipboardPaste size={14} /> Colar Texto
          </button>
          <button className={`tab ${importTab === 'manual' ? 'active' : ''}`} onClick={() => setImportTab('manual')}>
            <PlusCircle size={14} /> Manual
          </button>
          <button className={`tab ${importTab === 'avulsa' ? 'active' : ''}`} onClick={() => setImportTab('avulsa')}>
            <UserCheck size={14} /> Avulsa
          </button>
        </div>

        {/* FILE TAB */}
        {importTab === 'file' && (
          <div
            className="upload-area"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={40} />
            <p>
              <span>Clique para selecionar</span> ou arraste o arquivo CSV do Wix
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              Formato aceito: CSV (.csv) exportado do Wix Store
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </div>
        )}

        {/* PASTE TAB */}
        {importTab === 'paste' && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              Cole o conteudo copiado do PDF dos pedidos Wix. Suporta ate 50 pedidos de uma vez — basta colar todos juntos. O sistema detecta automaticamente cada pedido, itens, valores e quantidades.
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`Exemplo:\nPedido 10249 (8 itens) Alex Bento, alex@email.com\nFeito em 2 de mar. de 2026, 22:09\nOVO - Sedosa Splash R$ 24,00 x2 R$ 48,00\nOVO - Polonesa Dourada R$ 20,00 x2 R$ 40,00\n...`}
              style={{
                width: '100%',
                minHeight: 180,
                padding: 12,
                borderRadius: 'var(--radius-sm)',
                border: '2px dashed var(--border)',
                background: 'var(--bg-secondary)',
                color: 'var(--text)',
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={handlePasteImport}
              disabled={!pasteText.trim() || importing}
            >
              <FileText size={16} /> Processar Texto
            </button>
          </div>
        )}

        {/* MANUAL TAB */}
        {importTab === 'manual' && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              Insira os dados do pedido manualmente.
            </p>

            {/* Order Info */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>N. Pedido</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Ex: 10249"
                  value={manualOrder.orderNumber}
                  onChange={(e) => setManualOrder(prev => ({ ...prev, orderNumber: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Comprador</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Nome do comprador"
                  value={manualOrder.buyerName}
                  onChange={(e) => setManualOrder(prev => ({ ...prev, buyerName: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Data</label>
                <input
                  type="date"
                  className="input"
                  value={manualOrder.date}
                  onChange={(e) => setManualOrder(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
            </div>

            {/* Items */}
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>Itens do Pedido</label>
            {manualOrder.items.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Ex: OVO - Brahma Light"
                  value={item.itemDescription}
                  onChange={(e) => updateManualItem(idx, 'itemDescription', e.target.value)}
                  style={{ flex: 3 }}
                />
                <input
                  type="number"
                  className="input"
                  placeholder="Qtd"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => updateManualItem(idx, 'quantity', e.target.value)}
                  style={{ flex: 1, minWidth: 60 }}
                />
                <div style={{ position: 'relative', flex: 2, minWidth: 100 }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-muted)' }}>R$</span>
                  <input
                    type="number"
                    className="input"
                    placeholder="0,00"
                    step="0.01"
                    min="0"
                    value={item.price}
                    onChange={(e) => updateManualItem(idx, 'price', e.target.value)}
                    style={{ paddingLeft: 32 }}
                  />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, minWidth: 80, textAlign: 'right', color: 'var(--text-muted)' }}>
                  = {formatCurrency((parseFloat(item.price) || 0) * (parseInt(item.quantity, 10) || 1))}
                </span>
                {manualOrder.items.length > 1 && (
                  <button
                    className="btn btn-sm btn-secondary"
                    style={{ padding: '4px 6px', color: 'var(--danger)' }}
                    onClick={() => removeManualItem(idx)}
                    title="Remover item"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}

            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={addManualItem}>
                <PlusCircle size={14} /> Adicionar Item
              </button>
              <button
                className="btn btn-primary"
                onClick={handleManualSubmit}
                disabled={importing}
              >
                <CheckCircle size={14} /> Registrar Venda
              </button>
            </div>
          </div>
        )}

        {/* AVULSA TAB — standalone sale addressed directly to an investor */}
        {importTab === 'avulsa' && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              Registre uma venda avulsa e direcione o lucro a um investidor especifico, sem precisar vincular uma ave. Informe um item, o valor e escolha o investidor.
            </p>

            {investors.length === 0 ? (
              <div style={{
                padding: 16, borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)',
                color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <AlertCircle size={18} /> Cadastre um investidor antes de criar uma venda avulsa.
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Investidor *</label>
                    <select
                      className="input"
                      value={avulsaForm.investorId}
                      onChange={(e) => setAvulsaForm(prev => ({ ...prev, investorId: e.target.value }))}
                    >
                      <option value="">Selecione o investidor</option>
                      {[...investors].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(inv => (
                        <option key={inv.id} value={inv.id}>{inv.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Tipo (taxa de lucro) *</label>
                    <select
                      className="input"
                      value={avulsaForm.type}
                      onChange={(e) => setAvulsaForm(prev => ({ ...prev, type: e.target.value }))}
                    >
                      <option value="egg">Ovo ({formatPercent(eggRate)})</option>
                      <option value="bird">Ave ({formatPercent(birdRate)})</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Descricao do Item *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Ex: Venda avulsa de ovos ferteis"
                    value={avulsaForm.itemDescription}
                    onChange={(e) => setAvulsaForm(prev => ({ ...prev, itemDescription: e.target.value }))}
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Valor Total (R$) *</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-muted)' }}>R$</span>
                      <input
                        type="number"
                        className="input"
                        placeholder="0,00"
                        step="0.01"
                        min="0"
                        value={avulsaForm.totalValue}
                        onChange={(e) => setAvulsaForm(prev => ({ ...prev, totalValue: e.target.value }))}
                        style={{ paddingLeft: 32, width: '100%' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Quantidade</label>
                    <input
                      type="number"
                      className="input"
                      min="1"
                      value={avulsaForm.quantity}
                      onChange={(e) => setAvulsaForm(prev => ({ ...prev, quantity: e.target.value }))}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Data</label>
                    <input
                      type="date"
                      className="input"
                      value={avulsaForm.date}
                      onChange={(e) => setAvulsaForm(prev => ({ ...prev, date: e.target.value }))}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Comprador / Observacao (opcional)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Nome do comprador ou observacao"
                    value={avulsaForm.buyerName}
                    onChange={(e) => setAvulsaForm(prev => ({ ...prev, buyerName: e.target.value }))}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Live profit preview */}
                {(parseFloat(avulsaForm.totalValue) || 0) > 0 && (
                  <div style={{
                    fontSize: 13, padding: '10px 12px', marginBottom: 12,
                    background: 'var(--success-bg)', color: 'var(--success)',
                    borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <UserCheck size={16} />
                    <span>
                      Lucro para o investidor:{' '}
                      <strong>
                        {formatCurrency((parseFloat(avulsaForm.totalValue) || 0) * (avulsaForm.type === 'egg' ? eggRate : birdRate))}
                      </strong>{' '}
                      ({formatPercent(avulsaForm.type === 'egg' ? eggRate : birdRate)} de {formatCurrency(parseFloat(avulsaForm.totalValue) || 0)})
                    </span>
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  onClick={handleAvulsaSubmit}
                  disabled={importing}
                >
                  <CheckCircle size={14} /> Registrar Venda Avulsa
                </button>
              </>
            )}
          </div>
        )}

        {importing && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--primary)' }}>
            Processando...
          </div>
        )}

        {importResult && (
          <div style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 'var(--radius-sm)',
            background: importResult.success ? 'var(--success-bg)' : 'var(--danger-bg)',
          }}>
            {importResult.success ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <CheckCircle size={20} color="var(--success)" />
                  <strong style={{ color: 'var(--success)' }}>
                    Importacao concluida ({importResult.source})!
                  </strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, fontSize: 13 }}>
                  {importResult.orderCount > 1 && (
                    <div><strong>{importResult.orderCount}</strong> pedidos processados</div>
                  )}
                  <div><strong>{importResult.total}</strong> itens no total</div>
                  <div><strong>{importResult.rejected}</strong> recusados/reembolsados</div>
                  <div><strong>{importResult.valid}</strong> vendas validas</div>
                  <div><strong>{importResult.matched}</strong> vinculadas</div>
                  <div><strong>{importResult.unmatched}</strong> sem vinculo</div>
                  <div><strong>{formatCurrency(importResult.totalValue)}</strong> valor total</div>
                  <div><strong>{formatCurrency(importResult.totalProfit)}</strong> lucro distribuido</div>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={20} color="var(--danger)" />
                <span style={{ color: 'var(--danger)' }}>Erro: {importResult.error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Distribution Summary */}
      {Object.keys(distribution.distribution).length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">Resumo da Distribuicao</span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Investidor</th>
                  <th>Lucro Ovos ({formatPercent(eggRate)})</th>
                  <th>Lucro Aves ({formatPercent(birdRate)})</th>
                  <th>Total</th>
                  <th>Itens</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(distribution.distribution).map(([investorId, d]) => (
                  <tr key={investorId}>
                    <td><strong>{getInvestorName(investorId)}</strong></td>
                    <td style={{ color: 'var(--primary)' }}>{formatCurrency(d.eggProfit)}</td>
                    <td style={{ color: 'var(--info)' }}>{formatCurrency(d.birdProfit)}</td>
                    <td><strong style={{ color: 'var(--success)' }}>{formatCurrency(d.totalProfit)}</strong></td>
                    <td>{d.items.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sales List */}
      {sales.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Vendas Importadas ({filteredSales.length})</span>
            <div className="tabs">
              {[
                { key: 'all', label: 'Todas' },
                { key: 'eggs', label: 'Ovos' },
                { key: 'birds', label: 'Aves' },
                { key: 'matched', label: 'Vinculadas' },
                { key: 'unmatched', label: 'Sem Vinculo' },
              ].map(tab => (
                <button
                  key={tab.key}
                  className={`tab ${filterType === tab.key ? 'active' : ''}`}
                  onClick={() => { setFilterType(tab.key); setCurrentPage(1); }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('date')}>Data{sortIndicator('date')}</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('orderNumber')}>Pedido{sortIndicator('orderNumber')}</th>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Qtd</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('totalValue')}>Valor{sortIndicator('totalValue')}</th>
                  <th>Taxa</th>
                  <th>Lucro</th>
                  <th>Investidor</th>
                  <th style={{ width: 80, textAlign: 'center' }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {paginatedSales.map((sale, idx) => (
                  <tr key={sale.id || idx}>
                    <td>{formatDate(sale.date)}</td>
                    <td style={{ fontSize: 12 }}>{sale.orderNumber || '-'}</td>
                    <td style={{ maxWidth: 220 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {sale.isManual && (
                          <span
                            className="badge"
                            style={{ background: 'var(--warning-bg, #fef3c7)', color: 'var(--warning, #d97706)', flexShrink: 0, fontSize: 10 }}
                            title="Venda avulsa direcionada a um investidor"
                          >
                            Avulsa
                          </span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sale.itemDescription || sale.item || '-'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${sale.isEgg ? 'badge-purple' : 'badge-blue'}`}>
                        {sale.isEgg ? 'Ovo' : 'Ave'}
                      </span>
                    </td>
                    <td>{sale.quantity || 1}</td>
                    <td>{formatCurrency(sale.totalValue)}</td>
                    <td>{formatPercent(getSaleRateInfo(sale, rates, birdById[sale.matchedBirdId]).rate)}</td>
                    <td style={{ color: 'var(--success)', fontWeight: 600 }}>
                      {sale.matchedInvestorId
                        ? formatCurrency(
                            typeof sale.profit === 'number'
                              ? sale.profit
                              : (parseFloat(sale.totalValue) || 0)
                                * getSaleRateInfo(sale, rates, birdById[sale.matchedBirdId]).rate
                          )
                        : '-'}
                    </td>
                    <td>
                      {sale.matchedInvestorId ? (
                        <span style={{ fontSize: 12 }}>{getInvestorName(sale.matchedInvestorId)}</span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nao vinculada</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button
                          className="btn btn-sm btn-secondary"
                          style={{ padding: '4px 6px' }}
                          title="Editar venda"
                          onClick={() => handleStartEdit(sale)}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          style={{ padding: '4px 6px', color: 'var(--danger)' }}
                          title="Excluir venda"
                          onClick={() => handleDeleteSale(sale)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(1)}
                  style={{ padding: '4px 8px', fontSize: 12 }}
                >
                  &laquo;
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}
                  style={{ padding: '4px 8px', fontSize: 12 }}
                >
                  &lsaquo; Anterior
                </button>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 120, textAlign: 'center' }}>
                  Pagina {currentPage} de {totalPages} ({filteredSales.length} vendas)
                </span>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}
                  style={{ padding: '4px 8px', fontSize: 12 }}
                >
                  Proximo &rsaquo;
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  style={{ padding: '4px 8px', fontSize: 12 }}
                >
                  &raquo;
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {sales.length === 0 && (
        <div className="empty-state">
          <ShoppingCart size={48} />
          <h3>Nenhuma venda importada</h3>
          <p>Use as abas acima para importar CSV, colar texto de PDF ou inserir manualmente</p>
        </div>
      )}

      {/* Profit Rates Modal */}
      {showRatesModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={closeRatesModal}>
          <div style={{
            background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 24,
            width: '100%', maxWidth: 480, margin: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>Taxas Gerais de Lucro</h3>
              <button className="btn btn-sm btn-secondary" onClick={closeRatesModal} style={{ padding: '4px 6px' }}>
                <X size={16} />
              </button>
            </div>

            {ratesResult?.ok && (
              <div style={{
                marginBottom: 16, padding: 12, borderRadius: 'var(--radius-sm)',
                background: 'var(--success-bg)', color: 'var(--success)',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
              }}>
                <CheckCircle size={18} /> <span>{ratesResult.ok}</span>
              </div>
            )}
            {ratesResult?.error && (
              <div style={{
                marginBottom: 16, padding: 12, borderRadius: 'var(--radius-sm)',
                background: 'var(--danger-bg)', color: 'var(--danger)',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
              }}>
                <AlertCircle size={18} /> <span>{ratesResult.error}</span>
              </div>
            )}

            {!ratesPending ? (
              /* Step 1: edit the percentages */
              <form onSubmit={handleRatesContinue}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>
                  O <strong>ovo</strong> rende uma porcentagem do valor da venda. A{' '}
                  <strong>ave</strong> rende um valor fixo, que sai dessa mesma porcentagem
                  aplicada ao preco do ovo e multiplicada — por padrao, uma ave vale quatro ovos.
                  E por isso que a idade da ave nao muda mais a comissao.
                  <br /><br />
                  Estes sao os valores gerais. No Plantel cada lote pode ter a porcentagem e o
                  preco de ovo dele, e ai o do lote tem prioridade.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Lucro Ovos (%)</label>
                    <input
                      type="number" className="input" step="0.01" min="0" max="100" required
                      value={ratesForm.egg}
                      onChange={e => setRatesForm(prev => ({ ...prev, egg: e.target.value }))}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Preco geral do ovo (R$)
                    </label>
                    <input
                      type="number" className="input" step="0.01" min="0"
                      value={ratesForm.precoOvo}
                      onChange={e => setRatesForm(prev => ({ ...prev, precoOvo: e.target.value }))}
                      placeholder="Opcional"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Uma ave vale quantos ovos
                    </label>
                    <input
                      type="number" className="input" step="0.5" min="0.5"
                      value={ratesForm.multiplicador}
                      onChange={e => setRatesForm(prev => ({ ...prev, multiplicador: e.target.value }))}
                      placeholder={String(MULTIPLICADOR_AVE_PADRAO)}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Lucro Aves (%) — so importacoes
                    </label>
                    <input
                      type="number" className="input" step="0.01" min="0" max="100" required
                      value={ratesForm.bird}
                      onChange={e => setRatesForm(prev => ({ ...prev, bird: e.target.value }))}
                      style={{ width: '100%' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                      Nao vale mais para as vendas do Ornabird — la a ave e valor fixo. Sobra
                      para as vendas importadas de PDF/CSV, que continuam por percentual.
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                  Atual: ovos {formatPercent(eggRate)}, preco geral do ovo{' '}
                  {precoOvoReferencia ? formatCurrency(precoOvoReferencia) : 'nao definido'}, uma ave
                  vale {getMultiplicadorAve(comissaoConfig)} ovos, aves importadas{' '}
                  {formatPercent(birdRate)}.
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={closeRatesModal}>Cancelar</button>
                  <button type="submit" className="btn btn-primary">Continuar</button>
                </div>
              </form>
            ) : (
              /* Step 2: choose the scope of the change */
              <div>
                <p style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
                  Novas taxas: <strong>ovos {formatPercent(ratesPending.eggProfitRate)}</strong>,{' '}
                  preco geral do ovo{' '}
                  <strong>
                    {ratesPending.precoOvoReferencia
                      ? formatCurrency(ratesPending.precoOvoReferencia) : 'nao definido'}
                  </strong>, uma ave vale <strong>{ratesPending.multiplicadorAve} ovos</strong>,{' '}
                  <strong>aves importadas {formatPercent(ratesPending.birdProfitRate)}</strong>.
                  <br />Como aplicar?
                </p>

                <button
                  className="btn btn-primary"
                  disabled={ratesSaving}
                  onClick={() => applyRates(false)}
                  style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 10, textAlign: 'left', height: 'auto', padding: '12px 14px' }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>Somente novas vendas</div>
                    <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.9 }}>
                      As vendas ja registradas mantem as taxas antigas. Saldos e pagamentos nao mudam.
                    </div>
                  </div>
                </button>

                <button
                  className="btn btn-secondary"
                  disabled={ratesSaving}
                  onClick={() => applyRates(true)}
                  style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: '12px 14px', color: 'var(--warning)' }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>Recalcular todo o historico</div>
                    <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.9 }}>
                      Reaplica as novas taxas em todas as {sales.length} vendas. Altera os lucros e
                      saldos de todos os investidores. Nao pode ser desfeito.
                    </div>
                  </div>
                </button>

                <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" disabled={ratesSaving} onClick={() => setRatesPending(null)}>
                    Voltar
                  </button>
                </div>
                {ratesSaving && (
                  <div style={{ textAlign: 'center', paddingTop: 12, color: 'var(--primary)', fontSize: 13 }}>
                    Aplicando...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Sale Modal */}
      {editingSale && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setEditingSale(null)}>
          <div style={{
            background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 24,
            width: '100%', maxWidth: 480, margin: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>Editar Venda</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setEditingSale(null)} style={{ padding: '4px 6px' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Descricao do Item</label>
                <input
                  type="text"
                  className="input"
                  value={editingSale.itemDescription}
                  onChange={e => setEditingSale(prev => ({ ...prev, itemDescription: e.target.value }))}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Data</label>
                  <input
                    type="date"
                    className="input"
                    value={editingSale.date}
                    onChange={e => setEditingSale(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>N. Pedido</label>
                  <input
                    type="text"
                    className="input"
                    value={editingSale.orderNumber}
                    onChange={e => setEditingSale(prev => ({ ...prev, orderNumber: e.target.value }))}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Quantidade</label>
                  <input
                    type="number"
                    className="input"
                    min="1"
                    value={editingSale.quantity}
                    onChange={e => setEditingSale(prev => ({ ...prev, quantity: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Valor Total (R$)</label>
                  <input
                    type="number"
                    className="input"
                    step="0.01"
                    min="0"
                    value={editingSale.totalValue}
                    onChange={e => setEditingSale(prev => ({ ...prev, totalValue: e.target.value }))}
                  />
                </div>
              </div>
              {editingSale.isManual ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Investidor (avulsa)</label>
                      <select
                        className="input"
                        value={editingSale.matchedInvestorId}
                        onChange={e => setEditingSale(prev => ({ ...prev, matchedInvestorId: e.target.value }))}
                      >
                        <option value="">Sem investidor</option>
                        {[...investors].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(inv => (
                          <option key={inv.id} value={inv.id}>{inv.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Tipo (taxa)</label>
                      <select
                        className="input"
                        value={editingSale.type}
                        onChange={e => setEditingSale(prev => ({ ...prev, type: e.target.value }))}
                      >
                        <option value="egg">Ovo ({formatPercent(eggRate)})</option>
                        <option value="bird">Ave ({formatPercent(birdRate)})</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                    Venda avulsa — o lucro vai direto para o investidor escolhido, sem vinculo com ave.
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                  Tipo detectado: <strong>{isEggProduct(editingSale.itemDescription) ? `Ovo (${formatPercent(eggRate)})` : `Ave (${formatPercent(birdRate)})`}</strong> — O vinculo com investidor sera recalculado ao salvar.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditingSale(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>
                <Save size={14} /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
