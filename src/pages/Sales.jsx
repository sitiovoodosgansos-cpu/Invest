import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, calculateProfitDistribution,
  isEggProduct, getEggProfitRate, getBirdProfitRate, filterValidTransactions
} from '../utils/helpers';
import { parseCSV, readFileAsText } from '../utils/csvParser';
import { parseWixOrderText } from '../utils/pdfParser';
import {
  Upload, Trash2, CheckCircle, AlertCircle, ShoppingCart,
  FileText, ClipboardPaste, PlusCircle, X, Edit2, Save
} from 'lucide-react';

const EMPTY_MANUAL_ITEM = { itemDescription: '', quantity: 1, price: '' };

export default function Sales() {
  const { investors, birds, sales, addSales, clearSales, deleteSale, updateSale } = useApp();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [importTab, setImportTab] = useState('file'); // file | paste | manual
  const [pasteText, setPasteText] = useState('');
  const [manualOrder, setManualOrder] = useState({ orderNumber: '', buyerName: '', date: '', items: [{ ...EMPTY_MANUAL_ITEM }] });
  const [editingSale, setEditingSale] = useState(null);
  const fileInputRef = useRef(null);

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds),
    [sales, birds]
  );

  const validSales = useMemo(() => filterValidTransactions(sales), [sales]);

  // Process parsed rows (from CSV or PDF) into sales with profit distribution
  const processAndAddSales = (parsed) => {
    const valid = parsed.filter(row => {
      const status = (row.transactionStatus || '').toUpperCase();
      return !status.includes('RECUSAD') && !status.includes('REEMBOLSAD');
    });

    const rejected = parsed.length - valid.length;

    const processedSales = valid.map(row => {
      const description = row.itemDescription || row.item || '';
      const totalValue = parseFloat(row.totalValue || row.price || 0);
      const isEgg = isEggProduct(description);
      const rate = isEgg ? getEggProfitRate() : getBirdProfitRate();

      let matchedBirdId = null;
      let matchedInvestorId = null;
      let matchedBreed = null;

      for (const bird of birds) {
        const breedUpper = bird.breed.toUpperCase();
        if (description.toUpperCase().includes(breedUpper)) {
          matchedBirdId = bird.id;
          matchedInvestorId = bird.investorId;
          matchedBreed = bird.breed;
          break;
        }
        const words = bird.breed.toUpperCase().split(' ');
        if (words.length > 1 && words.every(w => description.toUpperCase().includes(w))) {
          matchedBirdId = bird.id;
          matchedInvestorId = bird.investorId;
          matchedBreed = bird.breed;
          break;
        }
      }

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

    addSales(processedSales);

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
      const result = processAndAddSales(parsed);
      result.source = 'CSV';
      setImportResult(result);
    } catch (err) {
      setImportResult({ success: false, error: err.message });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // PASTE TEXT
  const handlePasteImport = () => {
    if (!pasteText.trim()) return;

    setImporting(true);
    setImportResult(null);

    try {
      const pdfData = parseWixOrderText(pasteText);
      if (!pdfData.items || pdfData.items.length === 0) {
        throw new Error('Nenhum item encontrado no texto colado. Verifique o formato do recibo.');
      }
      const result = processAndAddSales(pdfData.items);
      result.source = 'Texto';
      result.orderNumber = pdfData.orderNumber;
      result.buyerName = pdfData.buyerName;
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

  const handleManualSubmit = () => {
    const validItems = manualOrder.items.filter(item =>
      item.itemDescription.trim() && parseFloat(item.price) > 0
    );

    if (validItems.length === 0) {
      setImportResult({ success: false, error: 'Adicione pelo menos um item com descricao e preco.' });
      return;
    }

    setImportResult(null);

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

    const result = processAndAddSales(parsed);
    result.source = 'Manual';
    setImportResult(result);
    setManualOrder({ orderNumber: '', buyerName: '', date: '', items: [{ ...EMPTY_MANUAL_ITEM }] });
  };

  const filteredSales = useMemo(() => {
    let list = validSales;
    if (filterType === 'eggs') list = list.filter(s => s.isEgg);
    if (filterType === 'birds') list = list.filter(s => !s.isEgg);
    if (filterType === 'matched') list = list.filter(s => s.matchedInvestorId);
    if (filterType === 'unmatched') list = list.filter(s => !s.matchedInvestorId);
    return list;
  }, [validSales, filterType]);

  const getInvestorName = (id) => investors.find(i => i.id === id)?.name || '-';

  const handleDeleteSale = (sale) => {
    if (window.confirm(`Excluir venda "${sale.itemDescription || sale.item || 'sem descricao'}"?`)) {
      deleteSale(sale.id);
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
    });
  };

  const handleSaveEdit = () => {
    if (!editingSale) return;
    const description = editingSale.itemDescription;
    const totalValue = parseFloat(editingSale.totalValue) || 0;
    const isEgg = isEggProduct(description);
    const rate = isEgg ? getEggProfitRate() : getBirdProfitRate();

    let matchedBirdId = null;
    let matchedInvestorId = null;
    let matchedBreed = null;
    for (const bird of birds) {
      const breedUpper = bird.breed.toUpperCase();
      if (description.toUpperCase().includes(breedUpper)) {
        matchedBirdId = bird.id;
        matchedInvestorId = bird.investorId;
        matchedBreed = bird.breed;
        break;
      }
      const words = bird.breed.toUpperCase().split(' ');
      if (words.length > 1 && words.every(w => description.toUpperCase().includes(w))) {
        matchedBirdId = bird.id;
        matchedInvestorId = bird.investorId;
        matchedBreed = bird.breed;
        break;
      }
    }

    updateSale(editingSale.id, {
      itemDescription: description,
      quantity: parseInt(editingSale.quantity, 10) || 1,
      totalValue,
      date: editingSale.date,
      orderNumber: editingSale.orderNumber,
      isEgg,
      profitRate: rate,
      profit: totalValue * rate,
      matchedBirdId,
      matchedInvestorId,
      matchedBreed,
    });
    setEditingSale(null);
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Vendas</h2>
        <p>Importe vendas do Wix (CSV, texto colado ou manual) e distribua lucros</p>
      </div>

      {/* Import Area */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">Importar Vendas</span>
          {sales.length > 0 && (
            <button className="btn btn-sm btn-secondary" style={{ color: 'var(--danger)' }} onClick={() => {
              if (window.confirm('Limpar todas as vendas importadas?')) clearSales();
            }}>
              <Trash2 size={14} /> Limpar Vendas
            </button>
          )}
        </div>

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
              Cole o conteudo copiado do PDF do pedido Wix. O sistema detecta automaticamente os itens, valores e quantidades.
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
                  <div><strong>{importResult.total}</strong> itens no pedido</div>
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
                  <th>Lucro Ovos (10%)</th>
                  <th>Lucro Aves (6,4%)</th>
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
                  onClick={() => setFilterType(tab.key)}
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
                  <th>Data</th>
                  <th>Pedido</th>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Qtd</th>
                  <th>Valor</th>
                  <th>Taxa</th>
                  <th>Lucro</th>
                  <th>Investidor</th>
                  <th style={{ width: 80, textAlign: 'center' }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.slice(0, 100).map((sale, idx) => (
                  <tr key={sale.id || idx}>
                    <td>{formatDate(sale.date)}</td>
                    <td style={{ fontSize: 12 }}>{sale.orderNumber || '-'}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sale.itemDescription || sale.item || '-'}
                    </td>
                    <td>
                      <span className={`badge ${sale.isEgg ? 'badge-purple' : 'badge-blue'}`}>
                        {sale.isEgg ? 'Ovo' : 'Ave'}
                      </span>
                    </td>
                    <td>{sale.quantity || 1}</td>
                    <td>{formatCurrency(sale.totalValue)}</td>
                    <td>{((sale.profitRate || (sale.isEgg ? 0.10 : 0.064)) * 100).toFixed(1)}%</td>
                    <td style={{ color: 'var(--success)', fontWeight: 600 }}>
                      {sale.matchedInvestorId ? formatCurrency(sale.profit || (sale.totalValue * (sale.isEgg ? 0.10 : 0.064))) : '-'}
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
            {filteredSales.length > 100 && (
              <p style={{ textAlign: 'center', padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>
                Exibindo 100 de {filteredSales.length} vendas
              </p>
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
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                Tipo detectado: <strong>{isEggProduct(editingSale.itemDescription) ? 'Ovo (10%)' : 'Ave (6,4%)'}</strong> — O vinculo com investidor sera recalculado ao salvar.
              </div>
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
