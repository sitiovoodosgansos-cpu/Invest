import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, calculateProfitDistribution,
  getInitials, getMonthsDifference, calculateCompoundInterest, groupSalesByPeriod
} from '../utils/helpers';
import { exportInvestorReport, exportGeneralReport } from '../utils/pdfExport';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend, PieChart, Pie, Cell
} from 'recharts';
import { FileDown, Eye, Users, Filter, Calendar, Link, Check, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

const COLORS = ['#6C2BD9', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'];

const REPORT_TABS = [
  { id: 'vendas', label: 'Vendas' },
  { id: 'investidores', label: 'Investidores' },
  { id: 'plantel', label: 'Plantel' },
  { id: 'ovos', label: 'Coleta de Ovos' },
  { id: 'chocadeira', label: 'Chocadeira' },
  { id: 'pintinhos', label: 'Pintinhos' },
  { id: 'sanidade', label: 'Sanidade' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'investor', label: 'Por Investidor' },
];

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function getDateFilterRange(filterType, specificMonth) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (filterType) {
    case 'today':
      return { start: todayStart, end: todayEnd, label: `Hoje (${formatDate(now.toISOString())})` };
    case '7days': {
      const start = new Date(todayStart);
      start.setDate(start.getDate() - 7);
      return { start, end: todayEnd, label: 'Ultimos 7 dias' };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end, label: `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}` };
    }
    case 'specific_month': {
      if (!specificMonth) return null;
      const [year, month] = specificMonth.split('-').map(Number);
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59, 999);
      return { start, end, label: `${MONTH_NAMES[month - 1]} ${year}` };
    }
    case 'last_year': {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      return { start, end, label: `Ano ${now.getFullYear() - 1}` };
    }
    case 'all':
    default:
      return null; // No filter
  }
}

function filterItemsByDate(items, dateRange) {
  if (!dateRange || !items) return items;
  return items.filter(item => {
    const d = new Date(item.date || item.data || item.importedAt);
    return d >= dateRange.start && d <= dateRange.end;
  });
}

// Generate month options for the dropdown (last 24 months)
function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    options.push({ value, label });
  }
  return options;
}

// Simple pagination controls for big tables.
function Pagination({ total, page, pageSize, onPage }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  // Show up to 7 page buttons with ellipsis
  const pages = [];
  const add = (p) => pages.push(p);
  if (totalPages <= 7) {
    for (let p = 1; p <= totalPages; p++) add(p);
  } else {
    add(1);
    if (page > 4) add('...');
    const from = Math.max(2, page - 2);
    const to = Math.min(totalPages - 1, page + 2);
    for (let p = from; p <= to; p++) add(p);
    if (page < totalPages - 3) add('...');
    add(totalPages);
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px', gap: 12, flexWrap: 'wrap', fontSize: 13,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>
        {start}-{end} de {total}
      </span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}
          disabled={page === 1} onClick={() => onPage(page - 1)}>Anterior</button>
        {pages.map((p, i) => p === '...' ? (
          <span key={`e${i}`} style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>...</span>
        ) : (
          <button key={p}
            className={`btn ${p === page ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '4px 10px', fontSize: 12, minWidth: 32 }}
            onClick={() => onPage(p)}
          >{p}</button>
        ))}
        <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}
          disabled={page === totalPages} onClick={() => onPage(page + 1)}>Proxima</button>
      </div>
    </div>
  );
}

export default function Reports() {
  const {
    investors, birds, sales, financialInvestments, payments, expenses,
    eggCollections, incubators, incubatorBatches,
    infirmaryBays, infirmaryAdmissions, treatments,
    nurseryRooms, nurseryBatches, nurseryEvents,
  } = useApp();
  // Report type: 'vendas' | 'investidores' | 'plantel' | 'ovos' |
  //              'chocadeira' | 'pintinhos' | 'sanidade' | 'financeiro' | 'investor'
  const [viewMode, setViewMode] = useState('vendas');
  const [selectedInvestor, setSelectedInvestor] = useState('');
  const [period, setPeriod] = useState('monthly');
  const [dateFilter, setDateFilter] = useState('all');
  const [specificMonth, setSpecificMonth] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [salesPage, setSalesPage] = useState(1);
  const ROWS_PER_PAGE = 50;

  // Reset pagination when filters change
  useEffect(() => { setSalesPage(1); }, [viewMode, dateFilter, specificMonth, sortField, sortDirection]);

  const copyInvestorLink = () => {
    if (!selectedInvestor) return;
    const baseUrl = window.location.origin + window.location.pathname;
    const link = `${baseUrl}#/portal/${selectedInvestor}`;
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds),
    [sales, birds]
  );

  const dateRange = useMemo(
    () => getDateFilterRange(dateFilter, specificMonth),
    [dateFilter, specificMonth]
  );

  const investor = investors.find(i => i.id === selectedInvestor);
  const investorBirds = birds.filter(b => b.investorId === selectedInvestor);
  const investorFinancial = financialInvestments.filter(f => f.investorId === selectedInvestor);
  const investorDist = distribution.distribution[selectedInvestor];

  // Filtered distribution (apply date filter to items)
  const filteredDist = useMemo(() => {
    if (!investorDist) return null;
    const filteredItems = filterItemsByDate(investorDist.items, dateRange);
    const eggProfit = filteredItems.filter(i => i.isEgg).reduce((s, i) => s + i.profit, 0);
    const birdProfit = filteredItems.filter(i => !i.isEgg).reduce((s, i) => s + i.profit, 0);
    return {
      items: filteredItems,
      eggProfit,
      birdProfit,
      totalProfit: eggProfit + birdProfit,
    };
  }, [investorDist, dateRange]);

  // Sort distribution items
  const sortedDistItems = useMemo(() => {
    if (!filteredDist || !filteredDist.items.length) return [];
    const items = [...filteredDist.items];
    const dir = sortDirection === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      switch (sortField) {
        case 'date': {
          const da = new Date(a.date || a.importedAt || 0).getTime();
          const db = new Date(b.date || b.importedAt || 0).getTime();
          return (da - db) * dir;
        }
        case 'type': {
          const ta = a.isEgg ? 0 : 1;
          const tb = b.isEgg ? 0 : 1;
          return (ta - tb) * dir;
        }
        case 'price':
          return ((a.totalValue || 0) - (b.totalValue || 0)) * dir;
        case 'profit':
          return ((a.profit || 0) - (b.profit || 0)) * dir;
        default:
          return 0;
      }
    });
    return items;
  }, [filteredDist, sortField, sortDirection]);

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown size={12} style={{ opacity: 0.3, marginLeft: 4 }} />;
    return sortDirection === 'asc'
      ? <ArrowUp size={12} style={{ marginLeft: 4, color: 'var(--primary)' }} />
      : <ArrowDown size={12} style={{ marginLeft: 4, color: 'var(--primary)' }} />;
  };

  const investorPayments = useMemo(() =>
    (payments || []).filter(p => p.investorId === selectedInvestor).sort((a, b) => new Date(b.date) - new Date(a.date)),
    [payments, selectedInvestor]
  );

  const totalBirdInvestment = investorBirds.reduce((s, b) => s + (parseFloat(b.investmentValue) || 0), 0);
  const totalMatrices = investorBirds.reduce((s, b) => s + (parseInt(b.matrixCount) || 0), 0);
  const totalBreeders = investorBirds.reduce((s, b) => s + (parseInt(b.breederCount) || 0), 0);

  const financialSummary = useMemo(() => {
    return investorFinancial.reduce((acc, f) => {
      const months = getMonthsDifference(f.date);
      const current = calculateCompoundInterest(parseFloat(f.amount), 0.03, months);
      return { invested: acc.invested + parseFloat(f.amount), current: acc.current + current };
    }, { invested: 0, current: 0 });
  }, [investorFinancial]);

  const balanceSummary = useMemo(() => {
    const totalPaid = investorPayments.reduce((s, p) => s + parseFloat(p.amount), 0);
    const salesProfit = filteredDist ? filteredDist.totalProfit : 0;
    const totalAccumulated = (financialSummary.current - financialSummary.invested) + salesProfit;
    const netBalance = totalAccumulated - totalPaid;
    return { totalPaid, salesProfit, totalAccumulated, netBalance };
  }, [investorPayments, financialSummary, filteredDist]);

  // Timeline for investor (uses filtered data)
  const timelineData = useMemo(() => {
    if (!filteredDist) return [];
    const grouped = groupSalesByPeriod(filteredDist.items, period);
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        period: key,
        ovos: items.filter(i => i.isEgg).reduce((s, i) => s + i.profit, 0),
        aves: items.filter(i => !i.isEgg).reduce((s, i) => s + i.profit, 0),
        total: items.reduce((s, i) => s + i.profit, 0),
      }));
  }, [filteredDist, period]);

  // Breed profit breakdown (uses filtered data)
  const breedData = useMemo(() => {
    if (!filteredDist) return [];
    const byBreed = {};
    filteredDist.items.forEach(item => {
      const breed = item.matchedBird || 'Outros';
      if (!byBreed[breed]) byBreed[breed] = 0;
      byBreed[breed] += item.profit;
    });
    const sorted = Object.entries(byBreed)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    if (sorted.length <= 5) return sorted;
    const top5 = sorted.slice(0, 5);
    const othersValue = sorted.slice(5).reduce((s, d) => s + d.value, 0);
    if (othersValue > 0) top5.push({ name: 'Outros', value: othersValue });
    return top5;
  }, [filteredDist]);

  const handleExportPDF = () => {
    if (!investor) return;
    try {
      const periodLabel = dateRange ? dateRange.label : 'Todos os periodos';
      exportInvestorReport(investor, birds, sales, financialInvestments, filteredDist, periodLabel, payments);
    } catch (err) {
      console.error('Erro ao exportar PDF:', err);
      alert('Erro ao gerar o PDF. Tente novamente.');
    }
  };

  const monthOptions = useMemo(() => getMonthOptions(), []);

  // ========== GENERAL (site-wide) REPORT DATA ==========
  // All computed regardless of selected investor; filtered by dateRange.
  const generalFinancialSummary = useMemo(() => {
    return (financialInvestments || []).reduce((acc, f) => {
      const months = getMonthsDifference(f.date);
      const current = calculateCompoundInterest(parseFloat(f.amount) || 0, 0.03, months);
      return {
        invested: acc.invested + (parseFloat(f.amount) || 0),
        current: acc.current + current,
      };
    }, { invested: 0, current: 0 });
  }, [financialInvestments]);

  const generalAllItems = useMemo(() => {
    // Merge every investor's distribution items into one list.
    const items = [];
    Object.values(distribution.distribution || {}).forEach(dist => {
      (dist.items || []).forEach(it => items.push(it));
    });
    return filterItemsByDate(items, dateRange);
  }, [distribution, dateRange]);

  const generalSalesProfit = useMemo(
    () => generalAllItems.reduce((s, i) => s + (i.profit || 0), 0),
    [generalAllItems]
  );
  const generalSalesRevenue = useMemo(
    () => generalAllItems.reduce((s, i) => s + (i.totalValue || 0), 0),
    [generalAllItems]
  );

  const generalTotalPaid = useMemo(
    () => filterItemsByDate(payments || [], dateRange).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0),
    [payments, dateRange]
  );

  const generalBirdInvestment = useMemo(
    () => (birds || []).reduce((s, b) => s + (parseFloat(b.investmentValue) || 0), 0),
    [birds]
  );

  const generalTimelineData = useMemo(() => {
    if (!generalAllItems.length) return [];
    const grouped = groupSalesByPeriod(generalAllItems, period);
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        period: key,
        ovos: items.filter(i => i.isEgg).reduce((s, i) => s + (i.profit || 0), 0),
        aves: items.filter(i => !i.isEgg).reduce((s, i) => s + (i.profit || 0), 0),
        total: items.reduce((s, i) => s + (i.profit || 0), 0),
      }));
  }, [generalAllItems, period]);

  const generalBreedData = useMemo(() => {
    if (!generalAllItems.length) return [];
    const byBreed = {};
    generalAllItems.forEach(item => {
      const breed = item.matchedBird || 'Outros';
      if (!byBreed[breed]) byBreed[breed] = 0;
      byBreed[breed] += (item.profit || 0);
    });
    const sorted = Object.entries(byBreed)
      .map(([name, value]) => ({ name, value }))
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);
    if (sorted.length <= 5) return sorted;
    const top5 = sorted.slice(0, 5);
    const outrosValue = sorted.slice(5).reduce((s, d) => s + d.value, 0);
    if (outrosValue > 0) top5.push({ name: 'Outros', value: outrosValue });
    return top5;
  }, [generalAllItems]);

  // Per-investor ranking table (site-wide)
  const investorRanking = useMemo(() => {
    const rows = investors.map(inv => {
      const invFin = (financialInvestments || []).filter(f => f.investorId === inv.id);
      const fInvested = invFin.reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);
      const fCurrent = invFin.reduce((s, f) => {
        const months = getMonthsDifference(f.date);
        return s + calculateCompoundInterest(parseFloat(f.amount) || 0, 0.03, months);
      }, 0);
      const financialProfit = fCurrent - fInvested;

      const invDist = distribution.distribution[inv.id];
      const items = invDist ? filterItemsByDate(invDist.items, dateRange) : [];
      const salesProfit = items.reduce((s, i) => s + (i.profit || 0), 0);

      const invPayments = filterItemsByDate(
        (payments || []).filter(p => p.investorId === inv.id),
        dateRange
      );
      const totalPaid = invPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);

      const totalAccumulated = financialProfit + salesProfit;
      const netBalance = totalAccumulated - totalPaid;
      return {
        id: inv.id,
        name: inv.name,
        financialProfit,
        salesProfit,
        totalAccumulated,
        totalPaid,
        netBalance,
      };
    });
    return rows.sort((a, b) => b.totalAccumulated - a.totalAccumulated);
  }, [investors, financialInvestments, distribution, payments, dateRange]);

  // Sorted general sales for the detail table
  const sortedGeneralItems = useMemo(() => {
    if (!generalAllItems.length) return [];
    const items = [...generalAllItems];
    const dir = sortDirection === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      switch (sortField) {
        case 'date': {
          const da = new Date(a.date || a.importedAt || 0).getTime();
          const db = new Date(b.date || b.importedAt || 0).getTime();
          return (da - db) * dir;
        }
        case 'order': {
          const oa = String(a.orderNumber || '');
          const ob = String(b.orderNumber || '');
          return oa.localeCompare(ob, undefined, { numeric: true }) * dir;
        }
        case 'item': {
          const ia = String(a.itemDescription || a.item || '');
          const ib = String(b.itemDescription || b.item || '');
          return ia.localeCompare(ib) * dir;
        }
        case 'type': {
          const ta = a.isEgg ? 0 : 1;
          const tb = b.isEgg ? 0 : 1;
          return (ta - tb) * dir;
        }
        case 'price':
          return ((a.totalValue || 0) - (b.totalValue || 0)) * dir;
        case 'profit':
          return ((a.profit || 0) - (b.profit || 0)) * dir;
        default:
          return 0;
      }
    });
    return items;
  }, [generalAllItems, sortField, sortDirection]);

  // ====== Module data aggregates (date-filtered where applicable) ======
  const filteredExpenses = useMemo(() => filterItemsByDate(expenses || [], dateRange), [expenses, dateRange]);
  const filteredPayments = useMemo(() => filterItemsByDate(payments || [], dateRange), [payments, dateRange]);
  const filteredEggCollections = useMemo(() => filterItemsByDate(eggCollections || [], dateRange), [eggCollections, dateRange]);
  const filteredIncubatorBatches = useMemo(() => {
    if (!dateRange) return incubatorBatches || [];
    return (incubatorBatches || []).filter(b => {
      const d = new Date(b.dateIn || b.createdAt || 0);
      return d >= dateRange.start && d <= dateRange.end;
    });
  }, [incubatorBatches, dateRange]);
  const filteredNurseryBatches = useMemo(() => {
    if (!dateRange) return nurseryBatches || [];
    return (nurseryBatches || []).filter(b => {
      const d = new Date(b.dateIn || b.createdAt || 0);
      return d >= dateRange.start && d <= dateRange.end;
    });
  }, [nurseryBatches, dateRange]);
  const filteredNurseryEvents = useMemo(() => filterItemsByDate(nurseryEvents || [], dateRange), [nurseryEvents, dateRange]);
  const filteredAdmissions = useMemo(() => {
    if (!dateRange) return infirmaryAdmissions || [];
    return (infirmaryAdmissions || []).filter(a => {
      const d = new Date(a.dateIn || a.createdAt || 0);
      return d >= dateRange.start && d <= dateRange.end;
    });
  }, [infirmaryAdmissions, dateRange]);
  const filteredTreatments = useMemo(() => filterItemsByDate(treatments || [], dateRange), [treatments, dateRange]);

  // Paginated helpers for big tables across modules
  const [modulePage, setModulePage] = useState(1);
  useEffect(() => { setModulePage(1); }, [viewMode, dateFilter, specificMonth]);
  const paginate = (arr) => arr.slice((modulePage - 1) * ROWS_PER_PAGE, modulePage * ROWS_PER_PAGE);

  // Resolve bird label by id (for Sanidade/Pintinhos/Chocadeira references)
  const birdLabel = (id) => {
    const b = birds.find(x => x.id === id);
    if (!b) return '-';
    return `${b.species || ''} - ${b.breed || ''}`.trim();
  };
  const incubatorName = (id) => (incubators.find(i => i.id === id) || {}).name || '-';
  const nurseryRoomName = (id) => (nurseryRooms.find(r => r.id === id) || {}).name || '-';
  const bayName = (id) => (infirmaryBays.find(b => b.id === id) || {}).name || '-';
  const investorName = (id) => (investors.find(i => i.id === id) || {}).name || '-';

  // Export general PDF: builds a report based on current viewMode
  const handleExportGeneralPDF = () => {
    try {
      const subtitle = dateRange ? dateRange.label : 'Todos os periodos';
      if (viewMode === 'vendas') {
        exportGeneralReport({
          title: 'Relatorio Geral - Vendas',
          subtitle,
          summary: [
            { label: 'Itens Vendidos', value: generalAllItems.length },
            { label: 'Receita Total', value: formatCurrency(generalSalesRevenue) },
            { label: 'Lucro Distribuido', value: formatCurrency(generalSalesProfit) },
            { label: 'Total Pago', value: formatCurrency(generalTotalPaid) },
            { label: 'Investidores', value: investors.length },
            { label: 'Aves Cadastradas', value: birds.length },
          ],
          sections: [
            {
              heading: 'Ranking de Investidores',
              head: ['#', 'Investidor', 'Rend. Aportes', 'Lucro Vendas', 'Total Acum.', 'Total Pago', 'Saldo'],
              rows: investorRanking.map((r, i) => [
                i + 1, r.name,
                formatCurrency(r.financialProfit), formatCurrency(r.salesProfit),
                formatCurrency(r.totalAccumulated), formatCurrency(r.totalPaid),
                formatCurrency(r.netBalance),
              ]),
              color: [108, 43, 217],
            },
            {
              heading: `Detalhamento de Vendas (${sortedGeneralItems.length})`,
              head: ['Data', 'Pedido', 'Item', 'Tipo', 'Raca', 'Valor', 'Lucro'],
              rows: sortedGeneralItems.map(it => [
                formatDate(it.date || it.importedAt),
                it.orderNumber || '-',
                (it.itemDescription || '-').slice(0, 40),
                it.isEgg ? 'Ovo' : 'Animal',
                it.matchedBird || '-',
                formatCurrency(it.totalValue),
                formatCurrency(it.profit),
              ]),
              color: [59, 130, 246],
            },
          ],
        });
      } else if (viewMode === 'investidores') {
        exportGeneralReport({
          title: 'Relatorio Geral - Investidores',
          subtitle,
          summary: [
            { label: 'Total de Investidores', value: investors.length },
            { label: 'Total Aportado', value: formatCurrency(generalFinancialSummary.invested) },
            { label: 'Valor Atual', value: formatCurrency(generalFinancialSummary.current) },
          ],
          sections: [{
            heading: 'Investidores',
            head: ['Nome', 'Email', 'Telefone', 'Aves', 'Aportado', 'Valor Atual'],
            rows: investors.map(i => {
              const invFin = (financialInvestments || []).filter(f => f.investorId === i.id);
              const fInv = invFin.reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);
              const fCur = invFin.reduce((s, f) => s + calculateCompoundInterest(parseFloat(f.amount) || 0, 0.03, getMonthsDifference(f.date)), 0);
              const nb = birds.filter(b => b.investorId === i.id).length;
              return [i.name || '-', i.email || '-', i.phone || '-', nb, formatCurrency(fInv), formatCurrency(fCur)];
            }),
            color: [108, 43, 217],
          }],
        });
      } else if (viewMode === 'plantel') {
        const totalMat = birds.reduce((s, b) => s + (parseInt(b.matrixCount) || 0), 0);
        const totalRep = birds.reduce((s, b) => s + (parseInt(b.breederCount) || 0), 0);
        const totalInv = birds.reduce((s, b) => s + (parseFloat(b.investmentValue) || 0), 0);
        exportGeneralReport({
          title: 'Relatorio Geral - Plantel',
          subtitle,
          summary: [
            { label: 'Registros', value: birds.length },
            { label: 'Matrizes', value: totalMat },
            { label: 'Reprodutores', value: totalRep },
            { label: 'Investimento Total', value: formatCurrency(totalInv) },
          ],
          sections: [{
            heading: 'Plantel',
            head: ['Especie', 'Raca', 'Investidor', 'Matrizes', 'Reprodutores', 'Investido'],
            rows: birds.map(b => [
              b.species || '-', b.breed || '-', investorName(b.investorId),
              b.matrixCount || 0, b.breederCount || 0,
              formatCurrency(b.investmentValue || 0),
            ]),
            color: [16, 185, 129],
          }],
        });
      } else if (viewMode === 'ovos') {
        const totalEggs = filteredEggCollections.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
        const totalCracked = filteredEggCollections.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
        exportGeneralReport({
          title: 'Relatorio Geral - Coleta de Ovos',
          subtitle,
          summary: [
            { label: 'Coletas', value: filteredEggCollections.length },
            { label: 'Ovos Coletados', value: totalEggs },
            { label: 'Ovos Trincados', value: totalCracked },
          ],
          sections: [{
            heading: 'Coletas',
            head: ['Data', 'Raca', 'Quantidade', 'Trincados', 'Notas'],
            rows: [...filteredEggCollections].sort((a, b) => new Date(b.date) - new Date(a.date)).map(c => [
              formatDate(c.date), birdLabel(c.birdId),
              c.quantity || 0, c.cracked || 0, (c.notes || '').slice(0, 40),
            ]),
            color: [245, 158, 11],
          }],
        });
      } else if (viewMode === 'chocadeira') {
        const totalEggs = filteredIncubatorBatches.reduce((s, b) => s + (parseInt(b.totalEggs) || 0), 0);
        const totalHatched = filteredIncubatorBatches.reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);
        exportGeneralReport({
          title: 'Relatorio Geral - Chocadeira',
          subtitle,
          summary: [
            { label: 'Chocadeiras', value: incubators.length },
            { label: 'Chocagens no periodo', value: filteredIncubatorBatches.length },
            { label: 'Ovos Incubados', value: totalEggs },
            { label: 'Nascidos', value: totalHatched },
          ],
          sections: [{
            heading: 'Chocagens',
            head: ['Data Inicio', 'Chocadeira', 'Ovos', 'Status', 'Nascidos', 'Inferteis', 'Morreu Ovo'],
            rows: [...filteredIncubatorBatches].sort((a, b) => new Date(b.dateIn) - new Date(a.dateIn)).map(b => [
              formatDate(b.dateIn), incubatorName(b.incubatorId),
              b.totalEggs || 0, b.status || '-',
              b.totalHatched || 0, b.totalInfertil || 0, b.totalMorreuNoOvo || 0,
            ]),
            color: [236, 72, 153],
          }],
        });
      } else if (viewMode === 'pintinhos') {
        const totalIn = filteredNurseryBatches.reduce((s, b) => s + (parseInt(b.quantityIn) || 0), 0);
        const totalOut = filteredNurseryBatches.reduce((s, b) => s + (parseInt(b.quantityOut) || 0), 0);
        const deaths = filteredNurseryEvents.filter(e => e.type === 'death').reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
        exportGeneralReport({
          title: 'Relatorio Geral - Pintinhos',
          subtitle,
          summary: [
            { label: 'Salas', value: nurseryRooms.length },
            { label: 'Lotes no periodo', value: filteredNurseryBatches.length },
            { label: 'Entradas', value: totalIn },
            { label: 'Saidas', value: totalOut },
            { label: 'Mortes', value: deaths },
          ],
          sections: [
            {
              heading: 'Lotes',
              head: ['Sala', 'Data Entrada', 'Qtd. Entrada', 'Status', 'Data Saida', 'Qtd. Saida'],
              rows: [...filteredNurseryBatches].sort((a, b) => new Date(b.dateIn) - new Date(a.dateIn)).map(b => [
                nurseryRoomName(b.roomId), formatDate(b.dateIn),
                b.quantityIn || 0, b.status || '-',
                b.dateOut ? formatDate(b.dateOut) : '-', b.quantityOut || 0,
              ]),
              color: [20, 184, 166],
            },
            {
              heading: 'Eventos',
              head: ['Data', 'Sala', 'Tipo', 'Qtd', 'Causa/Produto', 'Notas'],
              rows: [...filteredNurseryEvents].sort((a, b) => new Date(b.date) - new Date(a.date)).map(e => [
                formatDate(e.date), nurseryRoomName(e.roomId),
                e.type || '-', e.quantity || 0,
                e.cause || e.product || '-', (e.notes || '').slice(0, 30),
              ]),
              color: [59, 130, 246],
            },
          ],
        });
      } else if (viewMode === 'sanidade') {
        exportGeneralReport({
          title: 'Relatorio Geral - Sanidade',
          subtitle,
          summary: [
            { label: 'Baias', value: infirmaryBays.length },
            { label: 'Internacoes no periodo', value: filteredAdmissions.length },
            { label: 'Tratamentos no periodo', value: filteredTreatments.length },
          ],
          sections: [
            {
              heading: 'Internacoes',
              head: ['Data Entrada', 'Baia', 'Ave', 'Doenca', 'Status', 'Data Saida'],
              rows: [...filteredAdmissions].sort((a, b) => new Date(b.dateIn) - new Date(a.dateIn)).map(a => [
                formatDate(a.dateIn), bayName(a.bayId),
                a.birdLabel || '-', (a.disease || '-').slice(0, 30),
                a.status || '-', a.dateOut ? formatDate(a.dateOut) : '-',
              ]),
              color: [239, 68, 68],
            },
            {
              heading: 'Tratamentos',
              head: ['Data', 'Tipo', 'Ave', 'Produto', 'Dosagem', 'Notas'],
              rows: [...filteredTreatments].sort((a, b) => new Date(b.date) - new Date(a.date)).map(t => [
                formatDate(t.date), t.treatmentType || '-',
                t.birdLabel || 'Plantel geral', t.product || '-',
                t.dosage || '-', (t.notes || '').slice(0, 30),
              ]),
              color: [108, 43, 217],
            },
          ],
        });
      } else if (viewMode === 'financeiro') {
        const totalExp = filteredExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
        const totalPay = filteredPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        const totalInv = (financialInvestments || []).reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);
        exportGeneralReport({
          title: 'Relatorio Geral - Financeiro',
          subtitle,
          summary: [
            { label: 'Total Aportado', value: formatCurrency(generalFinancialSummary.invested) },
            { label: 'Valor Atual (3% a.m.)', value: formatCurrency(generalFinancialSummary.current) },
            { label: 'Rendimento', value: formatCurrency(generalFinancialSummary.current - generalFinancialSummary.invested) },
            { label: 'Despesas no periodo', value: formatCurrency(totalExp) },
            { label: 'Pagamentos no periodo', value: formatCurrency(totalPay) },
            { label: 'Total Investido (historico)', value: formatCurrency(totalInv) },
          ],
          sections: [
            {
              heading: 'Aportes',
              head: ['Data', 'Investidor', 'Valor', 'Meses', 'Valor Atual'],
              rows: (financialInvestments || []).map(f => {
                const months = getMonthsDifference(f.date);
                const current = calculateCompoundInterest(parseFloat(f.amount) || 0, 0.03, months);
                return [formatDate(f.date), investorName(f.investorId), formatCurrency(f.amount), months, formatCurrency(current)];
              }),
              color: [16, 185, 129],
            },
            {
              heading: `Despesas (${filteredExpenses.length})`,
              head: ['Data', 'Item', 'Categoria', 'Valor'],
              rows: [...filteredExpenses].sort((a, b) => new Date(b.date) - new Date(a.date)).map(e => [
                formatDate(e.date), (e.item || '-').slice(0, 40),
                e.category || '-', formatCurrency(e.amount),
              ]),
              color: [239, 68, 68],
            },
            {
              heading: `Pagamentos (${filteredPayments.length})`,
              head: ['Data', 'Investidor', 'Descricao', 'Valor'],
              rows: [...filteredPayments].sort((a, b) => new Date(b.date) - new Date(a.date)).map(p => [
                formatDate(p.date), investorName(p.investorId),
                (p.description || '-').slice(0, 40), formatCurrency(p.amount),
              ]),
              color: [217, 119, 6],
            },
          ],
        });
      }
    } catch (err) {
      console.error('Erro ao exportar PDF:', err);
      alert('Erro ao gerar o PDF. Tente novamente.');
    }
  };

  // ===== Render helpers (one per module) =====
  const StatCards = ({ cards }) => (
    <div className="stats-grid" style={{ marginBottom: 24 }}>
      {cards.map((c, i) => (
        <div key={i} className="stat-card">
          <div className="stat-label">{c.label}</div>
          <div className="stat-value" style={{ color: c.color || undefined, fontSize: c.fontSize || undefined }}>{c.value}</div>
          {c.change && <div className="stat-change positive">{c.change}</div>}
        </div>
      ))}
    </div>
  );

  const renderInvestidoresReport = () => {
    const rows = investors.map(i => {
      const invFin = (financialInvestments || []).filter(f => f.investorId === i.id);
      const fInv = invFin.reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);
      const fCur = invFin.reduce((s, f) => s + calculateCompoundInterest(parseFloat(f.amount) || 0, 0.03, getMonthsDifference(f.date)), 0);
      const nb = birds.filter(b => b.investorId === i.id).length;
      return { ...i, aves: nb, invested: fInv, current: fCur };
    });
    const pageItems = paginate(rows);
    return (
      <>
        <StatCards cards={[
          { label: 'Total de Investidores', value: investors.length },
          { label: 'Aves Vinculadas', value: birds.filter(b => b.investorId).length },
          { label: 'Total Aportado', value: formatCurrency(generalFinancialSummary.invested), color: 'var(--primary)' },
          { label: 'Valor Atual', value: formatCurrency(generalFinancialSummary.current), color: 'var(--success)' },
        ]} />
        <div className="card">
          <div className="card-header"><span className="card-title">Investidores ({rows.length})</span></div>
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Nome</th><th>Email</th><th>Telefone</th><th>Aves</th><th>Aportado</th><th>Valor Atual</th></tr>
              </thead>
              <tbody>
                {pageItems.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="investor-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{getInitials(r.name)}</div>
                        <span>{r.name}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 12 }}>{r.email || '-'}</td>
                    <td style={{ fontSize: 12 }}>{r.phone || '-'}</td>
                    <td>{r.aves}</td>
                    <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{formatCurrency(r.invested)}</td>
                    <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(r.current)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={modulePage} pageSize={ROWS_PER_PAGE} onPage={setModulePage} />
        </div>
      </>
    );
  };

  const renderPlantelReport = () => {
    const totalMat = birds.reduce((s, b) => s + (parseInt(b.matrixCount) || 0), 0);
    const totalRep = birds.reduce((s, b) => s + (parseInt(b.breederCount) || 0), 0);
    const totalInv = birds.reduce((s, b) => s + (parseFloat(b.investmentValue) || 0), 0);
    const bySpecies = {};
    birds.forEach(b => {
      const k = b.species || 'Outros';
      if (!bySpecies[k]) bySpecies[k] = 0;
      bySpecies[k] += (parseInt(b.matrixCount) || 0) + (parseInt(b.breederCount) || 0);
    });
    const speciesData = Object.entries(bySpecies).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const pageItems = paginate(birds);
    return (
      <>
        <StatCards cards={[
          { label: 'Registros', value: birds.length },
          { label: 'Matrizes', value: totalMat },
          { label: 'Reprodutores', value: totalRep },
          { label: 'Investimento Total', value: formatCurrency(totalInv), color: 'var(--primary)' },
        ]} />
        {speciesData.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header"><span className="card-title">Distribuicao por Especie</span></div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={speciesData} cx="50%" cy="50%" outerRadius={90} dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {speciesData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        <div className="card">
          <div className="card-header"><span className="card-title">Plantel ({birds.length})</span></div>
          <div className="table-container">
            <table>
              <thead><tr><th>Especie</th><th>Raca</th><th>Investidor</th><th>Matrizes</th><th>Reprodutores</th><th>Investido</th></tr></thead>
              <tbody>
                {pageItems.map(b => (
                  <tr key={b.id}>
                    <td>{b.species || '-'}</td>
                    <td><strong>{b.breed || '-'}</strong></td>
                    <td style={{ fontSize: 12 }}>{investorName(b.investorId)}</td>
                    <td>{b.matrixCount || 0}</td>
                    <td>{b.breederCount || 0}</td>
                    <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{formatCurrency(b.investmentValue || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={birds.length} page={modulePage} pageSize={ROWS_PER_PAGE} onPage={setModulePage} />
        </div>
      </>
    );
  };

  const renderOvosReport = () => {
    const totalEggs = filteredEggCollections.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
    const totalCracked = filteredEggCollections.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
    const sorted = [...filteredEggCollections].sort((a, b) => new Date(b.date) - new Date(a.date));
    const pageItems = paginate(sorted);
    return (
      <>
        <StatCards cards={[
          { label: 'Coletas', value: filteredEggCollections.length },
          { label: 'Ovos Coletados', value: totalEggs, color: 'var(--success)' },
          { label: 'Ovos Trincados', value: totalCracked, color: 'var(--danger)' },
          { label: 'Racas Diferentes', value: new Set(filteredEggCollections.map(c => c.birdId)).size },
        ]} />
        <div className="card">
          <div className="card-header"><span className="card-title">Coletas de Ovos ({sorted.length})</span></div>
          {sorted.length === 0 ? (
            <div className="empty-state"><p>Sem coletas no periodo</p></div>
          ) : (
            <>
              <div className="table-container">
                <table>
                  <thead><tr><th>Data</th><th>Raca</th><th>Quantidade</th><th>Trincados</th><th>Notas</th></tr></thead>
                  <tbody>
                    {pageItems.map(c => (
                      <tr key={c.id}>
                        <td>{formatDate(c.date)}</td>
                        <td>{birdLabel(c.birdId)}</td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{c.quantity || 0}</td>
                        <td style={{ color: 'var(--danger)' }}>{c.cracked || 0}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination total={sorted.length} page={modulePage} pageSize={ROWS_PER_PAGE} onPage={setModulePage} />
            </>
          )}
        </div>
      </>
    );
  };

  const renderChocadeiraReport = () => {
    const totalEggs = filteredIncubatorBatches.reduce((s, b) => s + (parseInt(b.totalEggs) || 0), 0);
    const totalHatched = filteredIncubatorBatches.reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);
    const totalInfertil = filteredIncubatorBatches.reduce((s, b) => s + (parseInt(b.totalInfertil) || 0), 0);
    const hatchRate = totalEggs > 0 ? (totalHatched / totalEggs * 100).toFixed(1) : '0';
    const sorted = [...filteredIncubatorBatches].sort((a, b) => new Date(b.dateIn) - new Date(a.dateIn));
    const pageItems = paginate(sorted);
    return (
      <>
        <StatCards cards={[
          { label: 'Chocadeiras', value: incubators.length },
          { label: 'Chocagens', value: filteredIncubatorBatches.length },
          { label: 'Ovos Incubados', value: totalEggs },
          { label: 'Nascidos', value: totalHatched, color: 'var(--success)' },
          { label: 'Inferteis', value: totalInfertil, color: 'var(--danger)' },
          { label: 'Taxa de Eclosao', value: `${hatchRate}%`, color: 'var(--primary)' },
        ]} />
        <div className="card">
          <div className="card-header"><span className="card-title">Chocagens ({sorted.length})</span></div>
          {sorted.length === 0 ? (
            <div className="empty-state"><p>Sem chocagens no periodo</p></div>
          ) : (
            <>
              <div className="table-container">
                <table>
                  <thead><tr><th>Data Inicio</th><th>Chocadeira</th><th>Ovos</th><th>Status</th><th>Nascidos</th><th>Inferteis</th><th>Morreu Ovo</th></tr></thead>
                  <tbody>
                    {pageItems.map(b => (
                      <tr key={b.id}>
                        <td>{formatDate(b.dateIn)}</td>
                        <td>{incubatorName(b.incubatorId)}</td>
                        <td>{b.totalEggs || 0}</td>
                        <td><span className="badge badge-purple" style={{ fontSize: 11 }}>{b.status || '-'}</span></td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{b.totalHatched || 0}</td>
                        <td style={{ color: 'var(--danger)' }}>{b.totalInfertil || 0}</td>
                        <td>{b.totalMorreuNoOvo || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination total={sorted.length} page={modulePage} pageSize={ROWS_PER_PAGE} onPage={setModulePage} />
            </>
          )}
        </div>
      </>
    );
  };

  const renderPintinhosReport = () => {
    const totalIn = filteredNurseryBatches.reduce((s, b) => s + (parseInt(b.quantityIn) || 0), 0);
    const totalOut = filteredNurseryBatches.reduce((s, b) => s + (parseInt(b.quantityOut) || 0), 0);
    const deaths = filteredNurseryEvents.filter(e => e.type === 'death').reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
    const sorted = [...filteredNurseryBatches].sort((a, b) => new Date(b.dateIn) - new Date(a.dateIn));
    const pageItems = paginate(sorted);
    return (
      <>
        <StatCards cards={[
          { label: 'Salas', value: nurseryRooms.length },
          { label: 'Lotes', value: filteredNurseryBatches.length },
          { label: 'Entradas', value: totalIn, color: 'var(--success)' },
          { label: 'Saidas', value: totalOut, color: 'var(--info)' },
          { label: 'Mortes', value: deaths, color: 'var(--danger)' },
          { label: 'Eventos', value: filteredNurseryEvents.length },
        ]} />
        <div className="card">
          <div className="card-header"><span className="card-title">Lotes ({sorted.length})</span></div>
          {sorted.length === 0 ? (
            <div className="empty-state"><p>Sem lotes no periodo</p></div>
          ) : (
            <>
              <div className="table-container">
                <table>
                  <thead><tr><th>Sala</th><th>Data Entrada</th><th>Qtd. Entrada</th><th>Status</th><th>Data Saida</th><th>Qtd. Saida</th></tr></thead>
                  <tbody>
                    {pageItems.map(b => (
                      <tr key={b.id}>
                        <td>{nurseryRoomName(b.roomId)}</td>
                        <td>{formatDate(b.dateIn)}</td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{b.quantityIn || 0}</td>
                        <td><span className="badge badge-blue" style={{ fontSize: 11 }}>{b.status || '-'}</span></td>
                        <td>{b.dateOut ? formatDate(b.dateOut) : '-'}</td>
                        <td>{b.quantityOut || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination total={sorted.length} page={modulePage} pageSize={ROWS_PER_PAGE} onPage={setModulePage} />
            </>
          )}
        </div>
      </>
    );
  };

  const renderSanidadeReport = () => {
    const activeAdms = filteredAdmissions.filter(a => a.status === 'active').length;
    const recoveredAdms = filteredAdmissions.filter(a => a.status === 'recovered').length;
    const diedAdms = filteredAdmissions.filter(a => a.status === 'died').length;
    const sortedAdms = [...filteredAdmissions].sort((a, b) => new Date(b.dateIn) - new Date(a.dateIn));
    const sortedTr = [...filteredTreatments].sort((a, b) => new Date(b.date) - new Date(a.date));
    const pageItemsAdm = paginate(sortedAdms);
    return (
      <>
        <StatCards cards={[
          { label: 'Baias', value: infirmaryBays.length },
          { label: 'Internacoes', value: filteredAdmissions.length },
          { label: 'Ativas', value: activeAdms, color: 'var(--info)' },
          { label: 'Recuperadas', value: recoveredAdms, color: 'var(--success)' },
          { label: 'Obitos', value: diedAdms, color: 'var(--danger)' },
          { label: 'Tratamentos', value: filteredTreatments.length },
        ]} />
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header"><span className="card-title">Internacoes ({sortedAdms.length})</span></div>
          {sortedAdms.length === 0 ? (
            <div className="empty-state"><p>Sem internacoes no periodo</p></div>
          ) : (
            <>
              <div className="table-container">
                <table>
                  <thead><tr><th>Data Entrada</th><th>Baia</th><th>Ave</th><th>Doenca</th><th>Status</th><th>Data Saida</th></tr></thead>
                  <tbody>
                    {pageItemsAdm.map(a => (
                      <tr key={a.id}>
                        <td>{formatDate(a.dateIn)}</td>
                        <td>{bayName(a.bayId)}</td>
                        <td style={{ fontSize: 12 }}>{a.birdLabel || '-'}</td>
                        <td>{a.disease || '-'}</td>
                        <td><span className="badge badge-purple" style={{ fontSize: 11 }}>{a.status || '-'}</span></td>
                        <td>{a.dateOut ? formatDate(a.dateOut) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination total={sortedAdms.length} page={modulePage} pageSize={ROWS_PER_PAGE} onPage={setModulePage} />
            </>
          )}
        </div>
        {sortedTr.length > 0 && (
          <div className="card">
            <div className="card-header"><span className="card-title">Tratamentos ({sortedTr.length})</span></div>
            <div className="table-container">
              <table>
                <thead><tr><th>Data</th><th>Tipo</th><th>Ave</th><th>Produto</th><th>Dosagem</th></tr></thead>
                <tbody>
                  {sortedTr.slice(0, 50).map(t => (
                    <tr key={t.id}>
                      <td>{formatDate(t.date)}</td>
                      <td>{t.treatmentType || '-'}</td>
                      <td style={{ fontSize: 12 }}>{t.birdLabel || 'Plantel geral'}</td>
                      <td>{t.product || '-'}</td>
                      <td>{t.dosage || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sortedTr.length > 50 && (
              <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                Exibindo os primeiros 50 de {sortedTr.length} tratamentos (exporte o PDF para a lista completa)
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  const renderFinanceiroReport = () => {
    const totalExp = filteredExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const totalPay = filteredPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const totalInv = (financialInvestments || []).reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);
    const sortedExp = [...filteredExpenses].sort((a, b) => new Date(b.date) - new Date(a.date));
    const pageItems = paginate(sortedExp);
    // Group expenses by category
    const byCategory = {};
    filteredExpenses.forEach(e => {
      const k = e.category || 'Sem categoria';
      byCategory[k] = (byCategory[k] || 0) + (parseFloat(e.amount) || 0);
    });
    const catData = Object.entries(byCategory).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    return (
      <>
        <StatCards cards={[
          { label: 'Total Aportado', value: formatCurrency(generalFinancialSummary.invested), color: 'var(--primary)' },
          { label: 'Valor Atual (3% a.m.)', value: formatCurrency(generalFinancialSummary.current), color: 'var(--success)' },
          { label: 'Rendimento', value: formatCurrency(generalFinancialSummary.current - generalFinancialSummary.invested), color: 'var(--info)' },
          { label: 'Despesas', value: formatCurrency(totalExp), color: 'var(--danger)' },
          { label: 'Pagamentos', value: formatCurrency(totalPay), color: '#D97706' },
          { label: 'Historico Aportes', value: formatCurrency(totalInv) },
        ]} />
        {catData.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header"><span className="card-title">Despesas por Categoria</span></div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={catData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={v => `R$${v.toFixed(0)}`} />
                  <Tooltip formatter={v => formatCurrency(v)} />
                  <Bar dataKey="value" fill="#EF4444" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        <div className="card">
          <div className="card-header"><span className="card-title">Despesas ({sortedExp.length})</span></div>
          {sortedExp.length === 0 ? (
            <div className="empty-state"><p>Sem despesas no periodo</p></div>
          ) : (
            <>
              <div className="table-container">
                <table>
                  <thead><tr><th>Data</th><th>Item</th><th>Categoria</th><th>Valor</th></tr></thead>
                  <tbody>
                    {pageItems.map(e => (
                      <tr key={e.id}>
                        <td>{formatDate(e.date)}</td>
                        <td>{e.item || '-'}</td>
                        <td><span className="badge badge-blue" style={{ fontSize: 11 }}>{e.category || '-'}</span></td>
                        <td style={{ color: 'var(--danger)', fontWeight: 600 }}>{formatCurrency(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination total={sortedExp.length} page={modulePage} pageSize={ROWS_PER_PAGE} onPage={setModulePage} />
            </>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Relatorios</h2>
        <p>Visualize e exporte relatorios gerais ou por investidor</p>
      </div>

      {/* Report type selector */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap',
        overflowX: 'auto', paddingBottom: 4,
      }}>
        {REPORT_TABS.map(tab => (
          <button
            key={tab.id}
            className={`btn ${viewMode === tab.id ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: 13, padding: '6px 12px', whiteSpace: 'nowrap' }}
            onClick={() => setViewMode(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter bar: date filter (all views) + investor selector (investor view) + actions */}
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 10 }}>
        {viewMode === 'investor' && (
          <select
            className="form-input"
            style={{ width: 'auto', minWidth: 250 }}
            value={selectedInvestor}
            onChange={e => setSelectedInvestor(e.target.value)}
          >
            <option value="">Selecione um investidor</option>
            {investors.map(i => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-card)', borderRadius: 10, padding: '4px 6px', border: '1px solid var(--border-light)' }}>
          <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
          <select
            className="form-input"
            style={{ width: 'auto', minWidth: 160, border: 'none', background: 'transparent', padding: '6px 8px' }}
            value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); if (e.target.value !== 'specific_month') setSpecificMonth(''); }}
          >
            <option value="all">Todos os periodos</option>
            <option value="today">Hoje</option>
            <option value="7days">Ultimos 7 dias</option>
            <option value="last_month">Ultimo mes</option>
            <option value="specific_month">Mes especifico</option>
            <option value="last_year">Ultimo ano</option>
          </select>

          {dateFilter === 'specific_month' && (
            <select
              className="form-input"
              style={{ width: 'auto', minWidth: 160, border: 'none', background: 'transparent', padding: '6px 8px' }}
              value={specificMonth}
              onChange={e => setSpecificMonth(e.target.value)}
            >
              <option value="">Selecione o mes</option>
              {monthOptions.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          )}
        </div>
        {dateRange && (
          <span className="badge badge-purple" style={{ fontSize: 12, padding: '6px 12px' }}>
            <Filter size={12} style={{ marginRight: 4 }} />
            {dateRange.label}
          </span>
        )}

        {viewMode !== 'investor' && (
          <button className="btn btn-primary" onClick={handleExportGeneralPDF}>
            <FileDown size={16} /> Exportar PDF
          </button>
        )}

        {viewMode === 'investor' && selectedInvestor && (
          <>
            <button className="btn btn-primary" onClick={handleExportPDF}>
              <FileDown size={16} /> Exportar PDF
            </button>
            <button
              className="btn"
              onClick={copyInvestorLink}
              style={{
                background: linkCopied ? 'var(--success)' : 'var(--primary)',
                color: '#fff',
                border: 'none',
              }}
            >
              {linkCopied ? <Check size={16} /> : <Link size={16} />}
              {linkCopied ? 'Link copiado!' : 'Copiar link do investidor'}
            </button>
          </>
        )}
      </div>

      {viewMode === 'vendas' ? (
        <>
          {/* ========== SALES / GENERAL SITE REPORT ========== */}
          {/* Summary stat cards */}
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-label">Investidores</div>
              <div className="stat-value">{investors.length}</div>
              <div className="stat-change positive">{birds.length} aves cadastradas</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Aportado</div>
              <div className="stat-value" style={{ color: 'var(--primary)' }}>{formatCurrency(generalFinancialSummary.invested)}</div>
              <div className="stat-change positive">Valor Atual: {formatCurrency(generalFinancialSummary.current)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Rendimento dos Aportes</div>
              <div className="stat-value" style={{ color: 'var(--info)' }}>+{formatCurrency(generalFinancialSummary.current - generalFinancialSummary.invested)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Investido no Plantel</div>
              <div className="stat-value" style={{ color: 'var(--primary)' }}>{formatCurrency(generalBirdInvestment)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Receita Total (Vendas)</div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(generalSalesRevenue)}</div>
              <div className="stat-change positive">{generalAllItems.length} itens vendidos</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Lucro Distribuido</div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(generalSalesProfit)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Pago aos Investidores</div>
              <div className="stat-value" style={{ color: '#D97706' }}>{formatCurrency(generalTotalPaid)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Saldo a Pagar</div>
              <div className="stat-value" style={{
                color: ((generalFinancialSummary.current - generalFinancialSummary.invested) + generalSalesProfit - generalTotalPaid) >= 0 ? 'var(--success)' : 'var(--danger)'
              }}>
                {formatCurrency((generalFinancialSummary.current - generalFinancialSummary.invested) + generalSalesProfit - generalTotalPaid)}
              </div>
            </div>
          </div>

          {/* Charts: timeline + breed pie */}
          <div className="grid-2">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Evolucao de Lucros (Geral)</span>
                <div className="period-selector">
                  {['daily', 'weekly', 'monthly', 'yearly'].map(p => (
                    <button
                      key={p}
                      className={`period-btn ${period === p ? 'active' : ''}`}
                      onClick={() => setPeriod(p)}
                    >
                      {{ daily: 'D', weekly: 'S', monthly: 'M', yearly: 'A' }[p]}
                    </button>
                  ))}
                </div>
              </div>
              {generalTimelineData.length > 0 ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={generalTimelineData}>
                      <defs>
                        <linearGradient id="colorGeneralProfit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6C2BD9" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#6C2BD9" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="period" fontSize={11} />
                      <YAxis fontSize={11} tickFormatter={v => `R$${v.toFixed(0)}`} />
                      <Tooltip formatter={v => formatCurrency(v)} />
                      <Legend />
                      <Area type="monotone" dataKey="ovos" name="Ovos" stroke="#6C2BD9" fill="url(#colorGeneralProfit)" />
                      <Area type="monotone" dataKey="aves" name="Animais" stroke="#3B82F6" fill="none" strokeDasharray="5 5" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state"><p>Sem dados de lucro{dateRange ? ` para ${dateRange.label}` : ''}</p></div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Top 5 Lucro por Raca</span>
              </div>
              {generalBreedData.length > 0 ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={generalBreedData}
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {generalBreedData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={v => formatCurrency(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state"><p>Sem dados de lucro por raca</p></div>
              )}
            </div>
          </div>

          {/* Investor ranking */}
          {investorRanking.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-header">
                <span className="card-title">Ranking de Investidores</span>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Investidor</th>
                      <th>Rend. Aportes</th>
                      <th>Lucro Vendas</th>
                      <th>Total Acumulado</th>
                      <th>Total Pago</th>
                      <th>Saldo Liquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {investorRanking.map((r, i) => (
                      <tr key={r.id}>
                        <td><strong>{i + 1}</strong></td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="investor-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                              {getInitials(r.name)}
                            </div>
                            <span>{r.name}</span>
                          </div>
                        </td>
                        <td style={{ color: 'var(--info)' }}>+{formatCurrency(r.financialProfit)}</td>
                        <td style={{ color: 'var(--success)' }}>{formatCurrency(r.salesProfit)}</td>
                        <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{formatCurrency(r.totalAccumulated)}</td>
                        <td style={{ color: '#D97706' }}>{formatCurrency(r.totalPaid)}</td>
                        <td style={{ fontWeight: 700, color: r.netBalance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {formatCurrency(r.netBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* General sales detail (sortable) */}
          {sortedGeneralItems.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-header">
                <span className="card-title">Detalhamento de Vendas ({sortedGeneralItems.length} itens)</span>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('date')}>
                        Data <SortIcon field="date" />
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('order')}>
                        Pedido <SortIcon field="order" />
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('item')}>
                        Item <SortIcon field="item" />
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('type')}>
                        Tipo <SortIcon field="type" />
                      </th>
                      <th>Raca</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('price')}>
                        Valor <SortIcon field="price" />
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('profit')}>
                        Lucro <SortIcon field="profit" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGeneralItems
                      .slice((salesPage - 1) * ROWS_PER_PAGE, salesPage * ROWS_PER_PAGE)
                      .map((item, idx) => (
                      <tr key={idx}>
                        <td>{formatDate(item.date || item.importedAt)}</td>
                        <td style={{ fontSize: 12 }}>{item.orderNumber || '-'}</td>
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.itemDescription || '-'}
                        </td>
                        <td><span className={`badge ${item.isEgg ? 'badge-purple' : 'badge-blue'}`}>{item.isEgg ? 'Ovo' : 'Animal'}</span></td>
                        <td>{item.matchedBird || '-'}</td>
                        <td>{formatCurrency(item.totalValue)}</td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(item.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                total={sortedGeneralItems.length}
                page={salesPage}
                pageSize={ROWS_PER_PAGE}
                onPage={setSalesPage}
              />
            </div>
          )}

          {generalAllItems.length === 0 && dateRange && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="empty-state">
                <Calendar size={36} />
                <h3>Nenhuma venda no periodo</h3>
                <p>Nao ha vendas registradas para "{dateRange.label}".</p>
              </div>
            </div>
          )}
        </>
      ) : viewMode === 'investidores' ? (
        renderInvestidoresReport()
      ) : viewMode === 'plantel' ? (
        renderPlantelReport()
      ) : viewMode === 'ovos' ? (
        renderOvosReport()
      ) : viewMode === 'chocadeira' ? (
        renderChocadeiraReport()
      ) : viewMode === 'pintinhos' ? (
        renderPintinhosReport()
      ) : viewMode === 'sanidade' ? (
        renderSanidadeReport()
      ) : viewMode === 'financeiro' ? (
        renderFinanceiroReport()
      ) : !selectedInvestor ? (
        <div className="empty-state">
          <Users size={48} />
          <h3>Selecione um investidor</h3>
          <p>Escolha um investidor para visualizar seu relatorio individual</p>
        </div>
      ) : (
        <>
          {/* Investor Summary */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div className="investor-avatar" style={{ width: 56, height: 56, fontSize: 20 }}>
                {getInitials(investor?.name)}
              </div>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 700 }}>{investor?.name}</h3>
                {investor?.email && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{investor.email}</p>}
              </div>
            </div>

            <div className="stats-grid" style={{ marginBottom: 0 }}>
              <div className="stat-card">
                <div className="stat-label">Animais no Plantel</div>
                <div className="stat-value">{totalMatrices + totalBreeders}</div>
                <div className="stat-change positive">{totalMatrices} matrizes / {totalBreeders} reprodutores</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Investido no Plantel</div>
                <div className="stat-value" style={{ color: 'var(--primary)' }}>{formatCurrency(totalBirdInvestment)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Lucro com Ovos</div>
                <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(filteredDist?.eggProfit || 0)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Lucro com Animais</div>
                <div className="stat-value" style={{ color: 'var(--info)' }}>{formatCurrency(filteredDist?.birdProfit || 0)}</div>
              </div>
            </div>
          </div>

          {/* Financial */}
          {investorFinancial.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">
                <span className="card-title">Aportes Financeiros (3% a.m.)</span>
              </div>
              <div className="stats-grid" style={{ marginBottom: 16 }}>
                <div>
                  <div className="stat-label">Total Aportado</div>
                  <div className="stat-value" style={{ fontSize: 20 }}>{formatCurrency(financialSummary.invested)}</div>
                </div>
                <div>
                  <div className="stat-label">Valor Atual</div>
                  <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>{formatCurrency(financialSummary.current)}</div>
                </div>
                <div>
                  <div className="stat-label">Rendimento</div>
                  <div className="stat-value" style={{ fontSize: 20, color: 'var(--info)' }}>+{formatCurrency(financialSummary.current - financialSummary.invested)}</div>
                </div>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>Data</th><th>Valor</th><th>Meses</th><th>Atual</th><th>Rendimento</th></tr>
                  </thead>
                  <tbody>
                    {investorFinancial.map(f => {
                      const months = getMonthsDifference(f.date);
                      const current = calculateCompoundInterest(parseFloat(f.amount), 0.03, months);
                      return (
                        <tr key={f.id}>
                          <td>{formatDate(f.date)}</td>
                          <td>{formatCurrency(f.amount)}</td>
                          <td>{months}</td>
                          <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(current)}</td>
                          <td style={{ color: 'var(--info)' }}>+{formatCurrency(current - parseFloat(f.amount))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Balance Summary */}
          {(investorFinancial.length > 0 || (filteredDist && filteredDist.totalProfit > 0) || investorPayments.length > 0) && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">
                <span className="card-title">Saldo do Investidor</span>
              </div>
              <div className="stats-grid" style={{ marginBottom: investorPayments.length > 0 ? 16 : 0 }}>
                <div className="stat-card">
                  <div className="stat-label">Rendimento do Aporte</div>
                  <div className="stat-value" style={{ fontSize: 18, color: 'var(--info)' }}>+{formatCurrency(financialSummary.current - financialSummary.invested)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Lucro com Vendas</div>
                  <div className="stat-value" style={{ fontSize: 18, color: 'var(--success)' }}>{formatCurrency(balanceSummary.salesProfit)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total Acumulado</div>
                  <div className="stat-value" style={{ fontSize: 18, color: 'var(--primary)' }}>{formatCurrency(balanceSummary.totalAccumulated)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total Pago</div>
                  <div className="stat-value" style={{ fontSize: 18, color: '#D97706' }}>{formatCurrency(balanceSummary.totalPaid)}</div>
                </div>
              </div>

              {/* Net balance highlight */}
              <div style={{
                background: balanceSummary.netBalance >= 0 ? 'var(--success-bg, #ecfdf5)' : 'var(--danger-bg, #fef2f2)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: investorPayments.length > 0 ? 16 : 0,
              }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Saldo Liquido</span>
                <span style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: balanceSummary.netBalance >= 0 ? 'var(--success)' : 'var(--danger)',
                }}>
                  {formatCurrency(balanceSummary.netBalance)}
                </span>
              </div>

              {/* Payments table */}
              {investorPayments.length > 0 && (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr><th>Data</th><th>Descricao</th><th>Valor Pago</th></tr>
                    </thead>
                    <tbody>
                      {investorPayments.map(p => (
                        <tr key={p.id}>
                          <td>{formatDate(p.date)}</td>
                          <td>{p.description || '-'}</td>
                          <td style={{ color: '#D97706', fontWeight: 600 }}>{formatCurrency(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Birds */}
          {investorBirds.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">
                <span className="card-title">Plantel do Investidor</span>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>Especie</th><th>Raca</th><th>Matrizes</th><th>Reprodutores</th><th>Investido</th></tr>
                  </thead>
                  <tbody>
                    {investorBirds.map(b => (
                      <tr key={b.id}>
                        <td>{b.species}</td>
                        <td><strong>{b.breed}</strong></td>
                        <td>{b.matrixCount || 0}</td>
                        <td>{b.breederCount || 0}</td>
                        <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{formatCurrency(b.investmentValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="grid-2">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Evolucao de Lucros</span>
                <div className="period-selector">
                  {['daily', 'weekly', 'monthly', 'yearly'].map(p => (
                    <button
                      key={p}
                      className={`period-btn ${period === p ? 'active' : ''}`}
                      onClick={() => setPeriod(p)}
                    >
                      {{ daily: 'D', weekly: 'S', monthly: 'M', yearly: 'A' }[p]}
                    </button>
                  ))}
                </div>
              </div>
              {timelineData.length > 0 ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData}>
                      <defs>
                        <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6C2BD9" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#6C2BD9" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="period" fontSize={11} />
                      <YAxis fontSize={11} tickFormatter={v => `R$${v.toFixed(0)}`} />
                      <Tooltip formatter={v => formatCurrency(v)} />
                      <Legend />
                      <Area type="monotone" dataKey="ovos" name="Ovos" stroke="#6C2BD9" fill="url(#colorProfit)" />
                      <Area type="monotone" dataKey="aves" name="Animais" stroke="#3B82F6" fill="none" strokeDasharray="5 5" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state"><p>Sem dados de lucro{dateRange ? ` para ${dateRange.label}` : ''}</p></div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Lucro por Raca</span>
              </div>
              {breedData.length > 0 ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={breedData}
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {breedData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={v => formatCurrency(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state"><p>Sem dados de lucro por raca</p></div>
              )}
            </div>
          </div>

          {/* Sales details */}
          {filteredDist && filteredDist.items.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-header">
                <span className="card-title">Detalhamento de Vendas ({filteredDist.items.length} itens)</span>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('date')}>
                        Data <SortIcon field="date" />
                      </th>
                      <th>Pedido</th>
                      <th>Item</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('type')}>
                        Tipo <SortIcon field="type" />
                      </th>
                      <th>Raca</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('price')}>
                        Valor <SortIcon field="price" />
                      </th>
                      <th>Taxa</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('profit')}>
                        Lucro <SortIcon field="profit" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDistItems.map((item, idx) => (
                      <tr key={idx}>
                        <td>{formatDate(item.date || item.importedAt)}</td>
                        <td style={{ fontSize: 12 }}>{item.orderNumber || '-'}</td>
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.itemDescription || '-'}
                        </td>
                        <td><span className={`badge ${item.isEgg ? 'badge-purple' : 'badge-blue'}`}>{item.isEgg ? 'Ovo' : 'Animal'}</span></td>
                        <td>{item.matchedBird || '-'}</td>
                        <td>{formatCurrency(item.totalValue)}</td>
                        <td>{(item.rate * 100).toFixed(1)}%</td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(item.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '16px 16px 0', borderTop: '2px solid var(--border)', marginTop: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lucro Ovos: </span>
                  <strong style={{ color: 'var(--primary)' }}>{formatCurrency(filteredDist.eggProfit)}</strong>
                </div>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lucro Animais: </span>
                  <strong style={{ color: 'var(--info)' }}>{formatCurrency(filteredDist.birdProfit)}</strong>
                </div>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total: </span>
                  <strong style={{ color: 'var(--success)', fontSize: 16 }}>{formatCurrency(filteredDist.totalProfit)}</strong>
                </div>
              </div>
            </div>
          )}

          {filteredDist && filteredDist.items.length === 0 && dateRange && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="empty-state">
                <Calendar size={36} />
                <h3>Nenhuma venda no periodo</h3>
                <p>Nao ha vendas registradas para "{dateRange.label}". Tente outro periodo.</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
