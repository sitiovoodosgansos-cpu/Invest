import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, calculateProfitDistribution,
  isEggProduct, getEggProfitRate, getBirdProfitRate, filterValidTransactions
} from '../utils/helpers';
import { parseCSV, readFileAsText } from '../utils/csvParser';
import {
  Upload, FileSpreadsheet, Trash2, CheckCircle, AlertCircle, ShoppingCart, Filter
} from 'lucide-react';

export default function Sales() {
  const { investors, birds, sales, addSales, clearSales } = useApp();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const fileInputRef = useRef(null);

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds),
    [sales, birds]
  );

  const validSales = useMemo(() => filterValidTransactions(sales), [sales]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    try {
      const text = await readFileAsText(file);
      const parsed = await parseCSV(text);

      // Filter out rejected/refunded
      const valid = parsed.filter(row => {
        const status = (row.transactionStatus || '').toUpperCase();
        return !status.includes('RECUSAD') && !status.includes('REEMBOLSAD');
      });

      const rejected = parsed.length - valid.length;

      // Process each item and distribute profit
      const processedSales = valid.map(row => {
        const description = row.itemDescription || row.item || '';
        const totalValue = parseFloat(row.totalValue || row.price || 0);
        const isEgg = isEggProduct(description);
        const rate = isEgg ? getEggProfitRate() : getBirdProfitRate();

        // Try to match to a bird
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
          // Try partial match
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

      setImportResult({
        success: true,
        total: parsed.length,
        valid: valid.length,
        rejected,
        matched,
        unmatched,
        totalValue: processedSales.reduce((s, p) => s + p.totalValue, 0),
        totalProfit: processedSales.filter(s => s.matchedInvestorId).reduce((s, p) => s + p.profit, 0),
      });
    } catch (err) {
      setImportResult({ success: false, error: err.message });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Vendas</h2>
        <p>Importe relatorios de vendas do Wix e distribua lucros automaticamente</p>
      </div>

      {/* Upload Area */}
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

        <div
          className="upload-area"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={40} />
          <p>
            <span>Clique para selecionar</span> ou arraste o arquivo CSV/Excel do Wix
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Formatos aceitos: CSV (.csv) exportado do Wix Store
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
        </div>

        {importing && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--primary)' }}>
            Processando arquivo...
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
                  <strong style={{ color: 'var(--success)' }}>Importacao concluida!</strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, fontSize: 13 }}>
                  <div><strong>{importResult.total}</strong> itens no arquivo</div>
                  <div><strong>{importResult.rejected}</strong> recusados/reembolsados</div>
                  <div><strong>{importResult.valid}</strong> vendas validas</div>
                  <div><strong>{importResult.matched}</strong> vinculadas</div>
                  <div><strong>{importResult.unmatched}</strong> sem vinculo</div>
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
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Taxa</th>
                  <th>Lucro</th>
                  <th>Investidor</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.slice(0, 100).map((sale, idx) => (
                  <tr key={sale.id || idx}>
                    <td>{formatDate(sale.date)}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sale.itemDescription || sale.item || '-'}
                    </td>
                    <td>
                      <span className={`badge ${sale.isEgg ? 'badge-purple' : 'badge-blue'}`}>
                        {sale.isEgg ? 'Ovo' : 'Ave'}
                      </span>
                    </td>
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
          <p>Importe um arquivo CSV do Wix para distribuir os lucros</p>
        </div>
      )}
    </div>
  );
}
