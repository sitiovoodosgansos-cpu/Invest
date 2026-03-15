import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { formatCurrency, formatDate, getMonthsDifference, calculateCompoundInterest } from '../utils/helpers';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import {
  Plus, Trash2, Edit2, Save, X, Image, Eye, FileDown, Receipt,
  ArrowUp, ArrowDown, ArrowUpDown, TrendingUp, Upload, FileSpreadsheet, AlertCircle, CheckCircle
} from 'lucide-react';

const DEFAULT_EXPENSE_CATEGORIES = [
  'Alimentacao Animal',
  'Remedios e Vacinas',
  'Estrutura e Manutencao',
  'Funcionarios',
  'Transporte e Frete',
  'Embalagens',
  'Energia e Agua',
  'Equipamentos',
  'Impostos e Taxas',
  'Rendimento Investidores',
  'Outros',
];

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const CATEGORY_COLORS = {
  'Alimentacao Animal': '#EF4444',
  'Remedios e Vacinas': '#F59E0B',
  'Estrutura e Manutencao': '#3B82F6',
  'Funcionarios': '#8B5CF6',
  'Transporte e Frete': '#EC4899',
  'Embalagens': '#14B8A6',
  'Energia e Agua': '#6366F1',
  'Equipamentos': '#10B981',
  'Impostos e Taxas': '#F97316',
  'Rendimento Investidores': '#D946EF',
  'Outros': '#94A3B8',
};

const CUSTOM_COLOR_PALETTE = [
  '#0EA5E9', '#E11D48', '#84CC16', '#A855F7', '#F43F5E',
  '#06B6D4', '#D97706', '#7C3AED', '#059669', '#DC2626',
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Expenses() {
  const { expenses, sales, financialInvestments, investors, customExpenseCategories, addExpense, bulkAddExpenses, updateExpense, deleteExpense, addCustomExpenseCategory, deleteCustomExpenseCategory } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [viewImage, setViewImage] = useState(null);
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterMonth, setFilterMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    item: '',
    category: '',
    imageData: null,
    imageName: '',
  });
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const csvInputRef = useRef(null);
  const imageInputRef = useRef(null);

  // Merge default + custom categories
  const customCats = customExpenseCategories || [];
  const allCategories = useMemo(() => {
    const customNames = customCats.map(c => c.name);
    return [...DEFAULT_EXPENSE_CATEGORIES, ...customNames];
  }, [customCats]);

  // Merge colors (custom categories get colors from palette)
  const allCategoryColors = useMemo(() => {
    const colors = { ...CATEGORY_COLORS };
    customCats.forEach((c, i) => {
      colors[c.name] = c.color || CUSTOM_COLOR_PALETTE[i % CUSTOM_COLOR_PALETTE.length];
    });
    return colors;
  }, [customCats]);

  // Generate virtual yield expenses from financial investments (3% monthly compound interest)
  const yieldExpenses = useMemo(() => {
    const entries = [];
    (financialInvestments || []).forEach(inv => {
      const investor = (investors || []).find(i => i.id === inv.investorId);
      const investorName = investor?.name || 'Investidor';
      const principal = parseFloat(inv.amount) || 0;
      if (principal <= 0) return;

      const startDate = new Date(inv.date);
      const now = new Date();
      const totalMonths = getMonthsDifference(inv.date);

      for (let m = 1; m <= totalMonths; m++) {
        // Yield for month m = principal * 1.03^(m-1) * 0.03
        const monthYield = principal * Math.pow(1.03, m - 1) * 0.03;
        const monthDate = new Date(startDate.getFullYear(), startDate.getMonth() + m, 1);
        // Use last day of the month for the expense date
        const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 0);
        if (lastDay > now) break;

        entries.push({
          id: `yield-${inv.id}-${m}`,
          date: lastDay.toISOString().slice(0, 10),
          amount: monthYield,
          item: `Rendimento 3% - ${investorName} (mes ${m})`,
          category: 'Rendimento Investidores',
          isAutomatic: true,
        });
      }
    });
    return entries;
  }, [financialInvestments, investors]);

  // Total yield cost
  const totalYieldCost = useMemo(() => {
    return yieldExpenses.reduce((s, e) => s + e.amount, 0);
  }, [yieldExpenses]);

  const manualExpenses = expenses || [];
  const allExpenses = useMemo(() => [...manualExpenses, ...yieldExpenses], [manualExpenses, yieldExpenses]);

  // Get available months from expenses
  const availableMonths = useMemo(() => {
    const months = new Set();
    allExpenses.forEach(e => {
      if (e.date) months.add(e.date.slice(0, 7));
    });
    return [...months].sort().reverse();
  }, [allExpenses]);

  // Filter and sort
  const filteredExpenses = useMemo(() => {
    let list = [...allExpenses];
    if (filterCategory !== 'all') list = list.filter(e => e.category === filterCategory);
    if (filterMonth !== 'all') list = list.filter(e => e.date && e.date.startsWith(filterMonth));

    const dir = sortDir === 'desc' ? -1 : 1;
    list.sort((a, b) => {
      if (sortField === 'date') return (a.date || '').localeCompare(b.date || '') * dir;
      if (sortField === 'amount') return ((parseFloat(a.amount) || 0) - (parseFloat(b.amount) || 0)) * dir;
      if (sortField === 'category') return (a.category || '').localeCompare(b.category || '') * dir;
      return 0;
    });
    return list;
  }, [allExpenses, filterCategory, filterMonth, sortField, sortDir]);

  const totalFiltered = filteredExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  // Monthly comparison data (expenses vs sales revenue)
  const monthlyComparison = useMemo(() => {
    const months = {};

    allExpenses.forEach(e => {
      if (!e.date) return;
      const key = e.date.slice(0, 7);
      if (!months[key]) months[key] = { month: key, expenses: 0, revenue: 0, categories: {} };
      months[key].expenses += parseFloat(e.amount) || 0;
      const cat = e.category || 'Outros';
      months[key].categories[cat] = (months[key].categories[cat] || 0) + (parseFloat(e.amount) || 0);
    });

    (sales || []).forEach(s => {
      if (!s.date) return;
      const key = s.date.slice(0, 7);
      if (!months[key]) months[key] = { month: key, expenses: 0, revenue: 0, categories: {} };
      months[key].revenue += parseFloat(s.totalValue) || 0;
    });

    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }, [allExpenses, sales]);

  // Chart data for the selected month (category breakdown)
  const monthChartData = useMemo(() => {
    const targetMonth = filterMonth !== 'all' ? filterMonth : (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    })();
    const monthData = monthlyComparison.find(m => m.month === targetMonth);
    if (!monthData || !monthData.categories) return [];
    return Object.entries(monthData.categories)
      .map(([cat, total]) => ({
        name: cat,
        valor: total,
        fill: allCategoryColors[cat] || '#94A3B8',
      }))
      .sort((a, b) => b.valor - a.valor);
  }, [monthlyComparison, filterMonth, allCategoryColors]);

  // Revenue for selected month
  const monthRevenue = useMemo(() => {
    const targetMonth = filterMonth !== 'all' ? filterMonth : (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    })();
    const monthData = monthlyComparison.find(m => m.month === targetMonth);
    return monthData ? monthData.revenue : 0;
  }, [monthlyComparison, filterMonth]);

  const monthExpensesTotal = useMemo(() => {
    return monthChartData.reduce((s, d) => s + d.valor, 0);
  }, [monthChartData]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown size={12} style={{ opacity: 0.3, marginLeft: 4 }} />;
    return sortDir === 'asc'
      ? <ArrowUp size={12} style={{ marginLeft: 4, color: 'var(--primary)' }} />
      : <ArrowDown size={12} style={{ marginLeft: 4, color: 'var(--primary)' }} />;
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('Imagem muito grande. Maximo 2MB.');
      return;
    }
    const base64 = await fileToBase64(file);
    setForm(prev => ({ ...prev, imageData: base64, imageName: file.name }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.amount || !form.item || !form.category) return;

    const expenseData = {
      date: form.date,
      amount: parseFloat(form.amount),
      item: form.item.trim(),
      category: form.category,
      imageData: form.imageData || null,
      imageName: form.imageName || null,
    };

    if (editingExpense) {
      updateExpense(editingExpense.id, expenseData);
    } else {
      addExpense(expenseData);
    }

    setForm({ date: new Date().toISOString().slice(0, 10), amount: '', item: '', category: '', imageData: null, imageName: '' });
    setEditingExpense(null);
    setShowModal(false);
  };

  const handleEdit = (expense) => {
    setEditingExpense(expense);
    setForm({
      date: expense.date || '',
      amount: expense.amount || '',
      item: expense.item || '',
      category: expense.category || '',
      imageData: expense.imageData || null,
      imageName: expense.imageName || '',
    });
    setShowModal(true);
  };

  const handleDelete = (expense) => {
    if (window.confirm(`Excluir despesa "${expense.item}"?`)) {
      deleteExpense(expense.id);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingExpense(null);
    setForm({ date: new Date().toISOString().slice(0, 10), amount: '', item: '', category: '', imageData: null, imageName: '' });
  };

  // ===== IMPORT FUNCTIONS =====
  const CATEGORY_KEYWORDS = {
    'Alimentacao Animal': ['racao', 'ração', 'milho', 'farelo', 'alimenta', 'alimento', 'soja', 'trigo', 'quirera', 'sorgo', 'sal mineral', 'comedouro', 'bebedouro', 'feno'],
    'Remedios e Vacinas': ['remedio', 'remédio', 'vacina', 'medicamento', 'vermifugo', 'vermífugo', 'antibiotico', 'antibiótico', 'vitamina', 'suplemento', 'piolhicida', 'veterinar'],
    'Estrutura e Manutencao': ['estrutura', 'manutencao', 'manutenção', 'cerca', 'tela', 'arame', 'madeira', 'tabua', 'tábua', 'prego', 'parafuso', 'cimento', 'areia', 'telha', 'reforma', 'construc', 'portão', 'portao', 'pintura', 'tinta'],
    'Funcionarios': ['funcionario', 'funcionário', 'salario', 'salário', 'pagamento func', 'diaria', 'diária', 'mao de obra', 'mão de obra'],
    'Transporte e Frete': ['transporte', 'frete', 'combustivel', 'combustível', 'gasolina', 'diesel', 'pedagio', 'pedágio', 'uber', 'viagem'],
    'Embalagens': ['embalagem', 'caixa', 'bandeja', 'sacola', 'saco', 'etiqueta', 'rotulo', 'rótulo'],
    'Energia e Agua': ['energia', 'luz', 'eletric', 'agua', 'água', 'conta de luz', 'conta de agua', 'esgoto', 'saneamento', 'copasa', 'cemig', 'celpe', 'enel', 'equatorial'],
    'Equipamentos': ['equipamento', 'ferramenta', 'chocadeira', 'incubadora', 'lampada', 'lâmpada', 'motor', 'bomba', 'maquina', 'máquina', 'ventilador'],
    'Impostos e Taxas': ['imposto', 'taxa', 'tributo', 'icms', 'issqn', 'iptu', 'inss', 'fgts', 'dar', 'darf', 'guia', 'licença', 'licenca', 'alvara', 'alvará'],
  };

  const classifyExpense = (description) => {
    const lower = (description || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const kw of keywords) {
        const kwNorm = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (lower.includes(kwNorm)) return category;
      }
    }
    for (const cat of customCats) {
      if (lower.includes(cat.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return cat.name;
    }
    return 'Outros';
  };

  const parseAmount = (str) => {
    if (!str || typeof str !== 'string') return 0;
    let clean = str.replace(/[R$\s]/g, '').trim();
    if (clean.includes(',')) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    }
    return parseFloat(clean) || 0;
  };

  const parseDate = (str) => {
    if (!str) return '';
    const s = str.trim();
    const brMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (brMatch) {
      const day = brMatch[1].padStart(2, '0');
      const month = brMatch[2].padStart(2, '0');
      let year = brMatch[3];
      if (year.length === 2) year = `20${year}`;
      return `${year}-${month}-${day}`;
    }
    const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    const monthYearMatch = s.match(/^(\d{1,2})[\/\-](\d{2,4})$/);
    if (monthYearMatch) {
      let year = monthYearMatch[2];
      if (year.length === 2) year = `20${year}`;
      return `${year}-${monthYearMatch[1].padStart(2, '0')}-01`;
    }
    return '';
  };

  const parseImportData = (text) => {
    if (!text.trim()) return [];
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return [];

    const results = [];
    const firstLine = lines[0];
    let separator = '\t';
    if (!firstLine.includes('\t')) {
      separator = firstLine.includes(';') ? ';' : ',';
    }

    const firstCols = firstLine.split(separator).map(c => c.trim().toLowerCase());
    const headerKeywords = ['data', 'date', 'valor', 'value', 'amount', 'descri', 'item', 'categoria', 'category', 'despesa'];
    const isHeader = firstCols.some(c => headerKeywords.some(k => c.includes(k)));

    let dateCol = -1, amountCol = -1, descCol = -1, catCol = -1;
    if (isHeader) {
      firstCols.forEach((c, i) => {
        if (dateCol < 0 && (c.includes('data') || c.includes('date') || c.includes('mes') || c.includes('mês'))) dateCol = i;
        if (amountCol < 0 && (c.includes('valor') || c.includes('value') || c.includes('amount') || c.includes('total') || c.includes('preco') || c.includes('preço') || c.includes('custo'))) amountCol = i;
        if (descCol < 0 && (c.includes('descri') || c.includes('item') || c.includes('despesa') || c.includes('produto') || c.includes('observ') || c.includes('detalhe'))) descCol = i;
        if (catCol < 0 && (c.includes('categori') || c.includes('tipo') || c.includes('classif'))) catCol = i;
      });
    }

    const dataLines = isHeader ? lines.slice(1) : lines;

    for (const line of dataLines) {
      const cols = line.split(separator).map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length < 2) continue;

      let date = '', amount = 0, description = '', category = '';

      if (dateCol >= 0 || amountCol >= 0 || descCol >= 0) {
        if (dateCol >= 0 && cols[dateCol]) date = parseDate(cols[dateCol]);
        if (amountCol >= 0 && cols[amountCol]) amount = parseAmount(cols[amountCol]);
        if (descCol >= 0 && cols[descCol]) description = cols[descCol];
        if (catCol >= 0 && cols[catCol]) category = cols[catCol];
        if (!description) {
          const usedCols = new Set([dateCol, amountCol, catCol].filter(c => c >= 0));
          description = cols.filter((_, i) => !usedCols.has(i)).join(' ').trim();
        }
      } else {
        for (let i = 0; i < cols.length; i++) {
          const parsed = parseDate(cols[i]);
          if (parsed && !date) { date = parsed; continue; }
          const amt = parseAmount(cols[i]);
          if (amt > 0 && !amount && /[\d,.]/.test(cols[i]) && cols[i].match(/\d/g)?.length >= 2) { amount = amt; continue; }
          if (cols[i] && !description) description = cols[i];
          else if (cols[i] && description && !category) category = cols[i];
        }
      }

      if (!amount || amount <= 0) continue;

      if (category) {
        const catLower = category.toLowerCase();
        const match = allCategories.find(c => c.toLowerCase() === catLower);
        if (match) category = match;
        else category = classifyExpense(category + ' ' + description);
      } else {
        category = classifyExpense(description);
      }

      if (!date) date = new Date().toISOString().slice(0, 10);

      results.push({ date, amount, item: description || 'Despesa importada', category });
    }
    return results;
  };

  const handleImportPreview = () => {
    const parsed = parseImportData(importText);
    setImportPreview(parsed);
    setImportResult(null);
  };

  const handleImportConfirm = () => {
    if (!importPreview || importPreview.length === 0) return;
    bulkAddExpenses(importPreview);
    setImportResult({ count: importPreview.length });
    setImportPreview(null);
    setImportText('');
  };

  const handleCsvFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImportText(ev.target.result);
      setImportPreview(null);
      setImportResult(null);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  // PDF Export - Monthly comparison
  const exportComparisonPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header
    doc.setFillColor(108, 43, 217);
    doc.rect(0, 0, pageWidth, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Sitio Voo dos Gansos', 14, 16);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Relatorio Financeiro - Comparativo Mensal', 14, 26);
    doc.setFontSize(9);
    doc.text(`Gerado em ${formatDate(new Date().toISOString())}`, pageWidth - 14, 34, { align: 'right' });

    let y = 50;

    // Monthly comparison table
    doc.setTextColor(30, 27, 75);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Comparativo Mes a Mes', 14, y);
    y += 4;

    const compRows = monthlyComparison.map(m => {
      const [yr, mo] = m.month.split('-');
      const monthLabel = `${MONTH_NAMES[parseInt(mo) - 1]} ${yr}`;
      const resultado = m.revenue - m.expenses;
      return [
        monthLabel,
        formatCurrency(m.revenue),
        formatCurrency(m.expenses),
        formatCurrency(resultado),
      ];
    });

    // Totals row
    const totRevenue = monthlyComparison.reduce((s, m) => s + m.revenue, 0);
    const totExpenses = monthlyComparison.reduce((s, m) => s + m.expenses, 0);
    compRows.push(['TOTAL', formatCurrency(totRevenue), formatCurrency(totExpenses), formatCurrency(totRevenue - totExpenses)]);

    autoTable(doc, {
      startY: y,
      head: [['Mes', 'Receita (Vendas)', 'Despesas', 'Resultado']],
      body: compRows,
      theme: 'striped',
      headStyles: { fillColor: [108, 43, 217], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        // Bold and color for totals row
        if (data.row.index === compRows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
        }
        // Color resultado column
        if (data.column.index === 3 && data.section === 'body') {
          const val = parseFloat(data.cell.raw?.replace(/[^\d,-]/g, '').replace(',', '.'));
          if (!isNaN(val)) {
            data.cell.styles.textColor = val >= 0 ? [16, 185, 129] : [239, 68, 68];
          }
        }
      },
    });

    y = doc.lastAutoTable.finalY + 14;

    // Expense breakdown by category
    if (y > 220) { doc.addPage(); y = 20; }

    doc.setTextColor(30, 27, 75);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Despesas por Categoria', 14, y);
    y += 4;

    const categoryTotals = {};
    allExpenses.forEach(e => {
      const cat = e.category || 'Outros';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (parseFloat(e.amount) || 0);
    });

    const catRows = Object.entries(categoryTotals)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, total]) => {
        const pct = totExpenses > 0 ? ((total / totExpenses) * 100).toFixed(1) : '0.0';
        return [cat, formatCurrency(total), `${pct}%`];
      });

    autoTable(doc, {
      startY: y,
      head: [['Categoria', 'Total', '% do Total']],
      body: catRows,
      theme: 'striped',
      headStyles: { fillColor: [239, 68, 68], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
    });

    y = doc.lastAutoTable.finalY + 10;

    // Summary box
    if (y > 250) { doc.addPage(); y = 20; }

    doc.setFillColor(248, 249, 252);
    doc.roundedRect(14, y, pageWidth - 28, 30, 4, 4, 'F');
    doc.setTextColor(30, 27, 75);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Receitas: ${formatCurrency(totRevenue)}`, 20, y + 10);
    doc.text(`Total Despesas: ${formatCurrency(totExpenses)}`, 20, y + 20);
    doc.setFont('helvetica', 'bold');
    const netResult = totRevenue - totExpenses;
    doc.setTextColor(...(netResult >= 0 ? [16, 185, 129] : [239, 68, 68]));
    doc.text(`Resultado: ${formatCurrency(netResult)}`, pageWidth - 20, y + 15, { align: 'right' });

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Sitio Voo dos Gansos - Relatorio gerado em ${formatDate(new Date().toISOString())} - Pagina ${i}/${pageCount}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Comparativo_Financeiro_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Category stats for summary (respects month filter)
  const categoryStats = useMemo(() => {
    const stats = {};
    const source = filterMonth !== 'all'
      ? allExpenses.filter(e => e.date && e.date.startsWith(filterMonth))
      : allExpenses;
    source.forEach(e => {
      const cat = e.category || 'Outros';
      stats[cat] = (stats[cat] || 0) + (parseFloat(e.amount) || 0);
    });
    return Object.entries(stats).sort(([, a], [, b]) => b - a);
  }, [allExpenses, filterMonth]);

  const totalExpenses = allExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const totalRevenue = (sales || []).reduce((s, e) => s + (parseFloat(e.totalValue) || 0), 0);

  // Yearly breakdown for stats
  const yearlyStats = useMemo(() => {
    const years = {};
    allExpenses.forEach(e => {
      if (!e.date) return;
      const y = e.date.slice(0, 4);
      if (!years[y]) years[y] = { expenses: 0, revenue: 0 };
      years[y].expenses += parseFloat(e.amount) || 0;
    });
    (sales || []).forEach(s => {
      if (!s.date) return;
      const y = s.date.slice(0, 4);
      if (!years[y]) years[y] = { expenses: 0, revenue: 0 };
      years[y].revenue += parseFloat(s.totalValue) || 0;
    });
    return Object.entries(years).sort(([a], [b]) => b.localeCompare(a));
  }, [allExpenses, sales]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / ITEMS_PER_PAGE));
  const paginatedExpenses = filteredExpenses.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Group paginated expenses by month
  const groupedByMonth = useMemo(() => {
    const groups = [];
    let currentMonth = '';
    for (const exp of paginatedExpenses) {
      const m = exp.date ? exp.date.slice(0, 7) : 'sem-data';
      if (m !== currentMonth) {
        currentMonth = m;
        groups.push({ month: m, items: [] });
      }
      groups[groups.length - 1].items.push(exp);
    }
    return groups;
  }, [paginatedExpenses]);

  const getMonthLabel = (key) => {
    if (key === 'sem-data') return 'Sem Data';
    const [y, mo] = key.split('-');
    return `${MONTH_NAMES[parseInt(mo) - 1]} ${y}`;
  };

  return (
    <div className="animate-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2>Saidas Financeiras</h2>
          <p>Controle de custos operacionais do sitio</p>
        </div>
        {/* Accumulated total badge */}
        <div style={{
          padding: '10px 20px', borderRadius: 'var(--radius-md)',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Acumulado Total</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--danger)', marginTop: 2 }}>{formatCurrency(totalExpenses)}</div>
          <div style={{ fontSize: 11, color: (totalRevenue - totalExpenses) >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
            Resultado: {formatCurrency(totalRevenue - totalExpenses)}
          </div>
        </div>
      </div>

      {/* Yearly Stats */}
      {yearlyStats.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, overflowX: 'auto', paddingBottom: 4 }}>
          {yearlyStats.map(([year, data]) => {
            const result = data.revenue - data.expenses;
            return (
              <div key={year} style={{
                minWidth: 200, flex: '1 0 200px', padding: 16,
                borderRadius: 'var(--radius-md)', background: 'var(--bg-card)',
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>{year}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Despesas</span>
                  <strong style={{ color: 'var(--danger)' }}>{formatCurrency(data.expenses)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Receitas</span>
                  <strong style={{ color: 'var(--success)' }}>{formatCurrency(data.revenue)}</strong>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Resultado</span>
                  <strong style={{ color: result >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(result)}</strong>
                </div>
                {totalYieldCost > 0 && (() => {
                  const yearYield = yieldExpenses.filter(e => e.date && e.date.startsWith(year)).reduce((s, e) => s + e.amount, 0);
                  return yearYield > 0 ? (
                    <div style={{ fontSize: 10, color: '#D946EF', marginTop: 4, fontWeight: 600 }}>
                      Rendimento inv.: {formatCurrency(yearYield)}
                    </div>
                  ) : null;
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* Action Bar */}
      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <select className="form-input" style={{ width: 'auto', minWidth: 180 }} value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setCurrentPage(1); }}>
          <option value="all">Todas as categorias</option>
          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="form-input" style={{ width: 'auto', minWidth: 160 }} value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setCurrentPage(1); }}>
          <option value="all">Todos os meses</option>
          {availableMonths.map(m => {
            const [y, mo] = m.split('-');
            return <option key={m} value={m}>{MONTH_NAMES[parseInt(mo) - 1]} {y}</option>;
          })}
        </select>
        <div style={{ flex: 1 }} />
        {monthlyComparison.length > 0 && (
          <button className="btn btn-secondary" onClick={exportComparisonPDF}>
            <FileDown size={16} /> Exportar Comparativo PDF
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => { setShowImportModal(true); setImportText(''); setImportPreview(null); setImportResult(null); }}>
          <Upload size={16} /> Importar
        </button>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Nova Despesa
        </button>
      </div>

      {/* Month Summary: Chart + Category Breakdown */}
      {monthChartData.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 24 }}>
          {/* Category bar chart */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Despesas por Categoria</span>
            </div>
            <div style={{ padding: '16px 16px 8px', height: Math.max(200, monthChartData.length * 36 + 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthChartData} layout="vertical" margin={{ left: 10, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" fontSize={11} tickFormatter={v => `R$${v.toFixed(0)}`} />
                  <YAxis type="category" dataKey="name" fontSize={11} width={140} tick={{ fill: 'var(--text)' }} />
                  <Tooltip formatter={v => formatCurrency(v)} />
                  <Bar dataKey="valor" name="Valor" radius={[0, 4, 4, 0]} barSize={22}>
                    {monthChartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Month resume card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Resumo do Mes</span>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Despesas</span>
                <strong style={{ fontSize: 18, color: 'var(--danger)' }}>{formatCurrency(monthExpensesTotal)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Receitas</span>
                <strong style={{ fontSize: 18, color: 'var(--success)' }}>{formatCurrency(monthRevenue)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Resultado</span>
                <strong style={{ fontSize: 20, color: (monthRevenue - monthExpensesTotal) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {formatCurrency(monthRevenue - monthExpensesTotal)}
                </strong>
              </div>

              {/* Category list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {categoryStats.map(([cat, total]) => {
                  const pct = monthExpensesTotal > 0 ? (total / monthExpensesTotal * 100) : 0;
                  return (
                    <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: allCategoryColors[cat] || '#94A3B8', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, flex: 1 }}>{cat}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 36, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                      <strong style={{ fontSize: 12, color: 'var(--danger)', minWidth: 80, textAlign: 'right' }}>{formatCurrency(total)}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expenses List - Grouped by Month */}
      {filteredExpenses.length > 0 ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Lancamentos ({filteredExpenses.length})</span>
            {filterCategory !== 'all' || filterMonth !== 'all' ? (
              <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>
                Total filtrado: {formatCurrency(totalFiltered)}
              </span>
            ) : null}
          </div>

          {groupedByMonth.map(group => {
            const monthTotal = group.items.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
            return (
              <div key={group.month}>
                {/* Month header */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 16px', background: 'var(--bg-secondary)',
                  borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{getMonthLabel(group.month)}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)' }}>{formatCurrency(monthTotal)}</span>
                </div>
                <div className="table-container" style={{ margin: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => { toggleSort('date'); setCurrentPage(1); }}>
                          Data <SortIcon field="date" />
                        </th>
                        <th>Item</th>
                        <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => { toggleSort('category'); setCurrentPage(1); }}>
                          Categoria <SortIcon field="category" />
                        </th>
                        <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => { toggleSort('amount'); setCurrentPage(1); }}>
                          Valor <SortIcon field="amount" />
                        </th>
                        <th style={{ width: 50, textAlign: 'center' }}>Img</th>
                        <th style={{ width: 80, textAlign: 'center' }}>Acoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map(expense => (
                        <tr key={expense.id}>
                          <td>{formatDate(expense.date)}</td>
                          <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {expense.item}
                          </td>
                          <td>
                            <span style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 10,
                              background: (allCategoryColors[expense.category] || '#94A3B8') + '20',
                              color: allCategoryColors[expense.category] || '#94A3B8',
                              fontWeight: 600,
                            }}>
                              {expense.category || '-'}
                            </span>
                          </td>
                          <td style={{ color: 'var(--danger)', fontWeight: 600 }}>{formatCurrency(expense.amount)}</td>
                          <td style={{ textAlign: 'center' }}>
                            {expense.imageData ? (
                              <button className="btn-icon" title="Ver comprovante" onClick={() => setViewImage(expense)} style={{ color: 'var(--primary)' }}>
                                <Eye size={16} />
                              </button>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>-</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {expense.isAutomatic ? (
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>Auto</span>
                            ) : (
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                <button className="btn-icon" title="Editar" onClick={() => handleEdit(expense)}><Edit2 size={14} /></button>
                                <button className="btn-icon" title="Excluir" onClick={() => handleDelete(expense)} style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-secondary" disabled={currentPage === 1} onClick={() => setCurrentPage(1)} style={{ padding: '4px 8px', fontSize: 12 }}>&laquo;</button>
              <button className="btn btn-sm btn-secondary" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} style={{ padding: '4px 8px', fontSize: 12 }}>&lsaquo; Anterior</button>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 140, textAlign: 'center' }}>
                Pagina {currentPage} de {totalPages} ({filteredExpenses.length} lancamentos)
              </span>
              <button className="btn btn-sm btn-secondary" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} style={{ padding: '4px 8px', fontSize: 12 }}>Proximo &rsaquo;</button>
              <button className="btn btn-sm btn-secondary" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)} style={{ padding: '4px 8px', fontSize: 12 }}>&raquo;</button>
            </div>
          )}

          <div style={{ padding: '12px 16px', background: 'var(--danger-bg, #fef2f2)', borderRadius: 'var(--radius-sm)', marginTop: 12, textAlign: 'right' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>Total: {formatCurrency(totalFiltered)}</span>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <Receipt size={48} />
          <h3>Nenhuma despesa registrada</h3>
          <p>Registre as saidas financeiras do sitio: alimentacao, remedios, funcionarios, etc.</p>
        </div>
      )}

      {/* New/Edit Expense Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h3 className="modal-title">{editingExpense ? 'Editar Despesa' : 'Nova Despesa'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Data *</label>
                  <input className="form-input" type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Valor (R$) *</label>
                  <input className="form-input" type="number" step="0.01" min="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0,00" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Item / Descricao *</label>
                <input className="form-input" type="text" required value={form.item} onChange={e => setForm({ ...form, item: e.target.value })} placeholder="Ex: Racao para gansos, Vacina, Conta de luz..." />
              </div>
              <div className="form-group">
                <label className="form-label">Categoria *</label>
                <select className="form-input" required value={form.category} onChange={e => {
                  if (e.target.value === '__new__') {
                    setShowNewCategoryInput(true);
                    setForm({ ...form, category: '' });
                  } else {
                    setForm({ ...form, category: e.target.value });
                  }
                }}>
                  <option value="">Selecione a categoria</option>
                  {allCategories.filter(c => c !== 'Rendimento Investidores').map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="__new__">+ Criar nova categoria...</option>
                </select>
                {showNewCategoryInput && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="Nome da nova categoria"
                      value={newCategoryName}
                      onChange={e => setNewCategoryName(e.target.value)}
                      autoFocus
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn btn-primary" style={{ fontSize: 13, padding: '6px 12px' }} onClick={() => {
                      const name = newCategoryName.trim();
                      if (!name) return;
                      if (allCategories.some(c => c.toLowerCase() === name.toLowerCase())) {
                        setForm({ ...form, category: allCategories.find(c => c.toLowerCase() === name.toLowerCase()) });
                        setShowNewCategoryInput(false);
                        setNewCategoryName('');
                        return;
                      }
                      const colorIndex = customCats.length % CUSTOM_COLOR_PALETTE.length;
                      addCustomExpenseCategory({ name, color: CUSTOM_COLOR_PALETTE[colorIndex] });
                      setForm({ ...form, category: name });
                      setShowNewCategoryInput(false);
                      setNewCategoryName('');
                    }}>
                      <Save size={14} />
                    </button>
                    <button type="button" className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }} onClick={() => {
                      setShowNewCategoryInput(false);
                      setNewCategoryName('');
                    }}>
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Comprovante (imagem)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => imageInputRef.current?.click()}
                    style={{ fontSize: 13 }}
                  >
                    <Image size={14} /> {form.imageData ? 'Trocar imagem' : 'Subir imagem'}
                  </button>
                  {form.imageName && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {form.imageName}
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', marginLeft: 4, padding: 0 }}
                        onClick={() => setForm(prev => ({ ...prev, imageData: null, imageName: '' }))}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  )}
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleImageUpload}
                  />
                </div>
                {form.imageData && (
                  <img
                    src={form.imageData}
                    alt="Preview"
                    style={{ marginTop: 8, maxHeight: 120, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
                  />
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Cancelar</button>
                <button type="submit" className="btn btn-primary">
                  <Save size={14} /> {editingExpense ? 'Salvar' : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Viewer Modal */}
      {viewImage && (
        <div className="modal-overlay" onClick={() => setViewImage(null)}>
          <div style={{
            background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 16,
            maxWidth: '90vw', maxHeight: '90vh', margin: 16, overflow: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>Comprovante</h3>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                  {viewImage.item} - {formatDate(viewImage.date)} - {formatCurrency(viewImage.amount)}
                </p>
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => setViewImage(null)} style={{ padding: '4px 6px' }}>
                <X size={16} />
              </button>
            </div>
            <img
              src={viewImage.imageData}
              alt="Comprovante"
              style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 'var(--radius-sm)' }}
            />
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 800 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>
                <FileSpreadsheet size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />
                Importar Despesas
              </h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowImportModal(false)} style={{ padding: '4px 6px' }}>
                <X size={16} />
              </button>
            </div>

            {importResult ? (
              <div style={{ textAlign: 'center', padding: 32 }}>
                <CheckCircle size={48} color="var(--success)" style={{ marginBottom: 16 }} />
                <h3 style={{ fontSize: 18, marginBottom: 8 }}>Importacao Concluida!</h3>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  {importResult.count} despesa{importResult.count !== 1 ? 's' : ''} importada{importResult.count !== 1 ? 's' : ''} com sucesso.
                </p>
                <button className="btn btn-primary" onClick={() => setShowImportModal(false)} style={{ marginTop: 16 }}>
                  Fechar
                </button>
              </div>
            ) : importPreview && importPreview.length > 0 ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: '#f0fdf4', borderRadius: 'var(--radius-sm)', border: '1px solid #bbf7d0' }}>
                  <CheckCircle size={16} color="#16a34a" />
                  <span style={{ fontSize: 13, color: '#166534' }}>
                    {importPreview.length} despesa{importPreview.length !== 1 ? 's' : ''} encontrada{importPreview.length !== 1 ? 's' : ''}. Revise e confirme abaixo.
                  </span>
                </div>

                {/* Category summary */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {Object.entries(importPreview.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + 1; return acc; }, {}))
                    .sort((a, b) => b[1] - a[1])
                    .map(([cat, count]) => (
                      <span key={cat} style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 12,
                        background: allCategoryColors[cat] ? `${allCategoryColors[cat]}20` : '#f1f5f9',
                        color: allCategoryColors[cat] || 'var(--text)',
                        fontWeight: 600, border: `1px solid ${allCategoryColors[cat] || '#e2e8f0'}`,
                      }}>
                        {cat}: {count}
                      </span>
                    ))
                  }
                </div>

                <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600 }}>Data</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600 }}>Descricao</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600 }}>Categoria</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, fontWeight: 600 }}>Valor</th>
                        <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: 11, fontWeight: 600, width: 36 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 10px', fontSize: 12 }}>{formatDate(item.date)}</td>
                          <td style={{ padding: '6px 10px', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.item}</td>
                          <td style={{ padding: '6px 10px' }}>
                            <select
                              className="form-input"
                              value={item.category}
                              onChange={e => {
                                setImportPreview(prev => prev.map((p, i) => i === idx ? { ...p, category: e.target.value } : p));
                              }}
                              style={{ fontSize: 11, padding: '3px 6px', height: 28, color: allCategoryColors[item.category] || 'var(--text)', fontWeight: 600 }}
                            >
                              {allCategories.filter(c => c !== 'Rendimento Investidores').map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--danger)', whiteSpace: 'nowrap' }}>
                            {formatCurrency(item.amount)}
                          </td>
                          <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                            <button
                              className="btn-icon"
                              onClick={() => setImportPreview(prev => prev.filter((_, i) => i !== idx))}
                              style={{ color: 'var(--danger)', padding: 2 }}
                              title="Remover"
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--bg-secondary)' }}>
                        <td colSpan={3} style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700 }}>Total</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>
                          {formatCurrency(importPreview.reduce((s, e) => s + e.amount, 0))}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => { setImportPreview(null); }}>
                    Voltar
                  </button>
                  <button className="btn btn-primary" onClick={handleImportConfirm}>
                    <Save size={14} /> Importar {importPreview.length} Despesa{importPreview.length !== 1 ? 's' : ''}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--text-secondary)' }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 600, color: 'var(--text)' }}>Como importar:</p>
                  <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                    <li>Abra sua planilha no Google Sheets</li>
                    <li>Selecione as linhas com as despesas (com ou sem cabecalho)</li>
                    <li>Copie (Ctrl+C) e cole na area abaixo</li>
                    <li>Ou envie um arquivo CSV clicando no botao abaixo</li>
                  </ol>
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                    Formatos aceitos: Data (DD/MM/AAAA ou AAAA-MM-DD), Valor (R$ 1.234,56 ou 1234.56), Descricao, Categoria (opcional).
                    As categorias serao classificadas automaticamente pela descricao.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    style={{ display: 'none' }}
                    onChange={handleCsvFileUpload}
                  />
                  <button className="btn btn-secondary btn-sm" onClick={() => csvInputRef.current?.click()}>
                    <FileSpreadsheet size={14} /> Enviar Arquivo CSV
                  </button>
                </div>

                <textarea
                  className="form-input"
                  value={importText}
                  onChange={e => { setImportText(e.target.value); setImportPreview(null); }}
                  placeholder={"Cole os dados da planilha aqui...\n\nExemplo:\nData\tDescricao\tValor\n15/01/2025\tRacao para aves\tR$ 350,00\n20/01/2025\tConta de energia\tR$ 180,50"}
                  rows={10}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                />

                {importText.trim() && importPreview !== null && importPreview.length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 12px', background: '#fef2f2', borderRadius: 'var(--radius-sm)', border: '1px solid #fecaca' }}>
                    <AlertCircle size={16} color="#dc2626" />
                    <span style={{ fontSize: 12, color: '#991b1b' }}>
                      Nenhuma despesa encontrada nos dados colados. Verifique o formato e tente novamente.
                    </span>
                  </div>
                )}

                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setShowImportModal(false)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={handleImportPreview} disabled={!importText.trim()}>
                    <Eye size={14} /> Visualizar Dados
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
