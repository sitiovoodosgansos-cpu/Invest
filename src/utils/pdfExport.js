import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, formatDate, getMonthsDifference, calculateCompoundInterest } from './helpers';

const ROWS_PER_PAGE = 50;

export function exportInvestorReport(investor, birds, sales, financialInvestments, distribution, periodLabel) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(108, 43, 217);
  doc.rect(0, 0, pageWidth, 45, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Sitio Voo dos Gansos', 14, 16);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('Relatorio de Investimentos', 14, 26);
  doc.setFontSize(10);
  doc.text(`Periodo: ${periodLabel || 'Todos os periodos'}`, 14, 35);
  doc.text(formatDate(new Date().toISOString()), pageWidth - 14, 35, { align: 'right' });

  let y = 57;

  // Investor info
  doc.setTextColor(30, 27, 75);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`Investidor: ${investor.name}`, 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  if (investor.email) doc.text(`Email: ${investor.email}`, 14, y);
  if (investor.phone) doc.text(`Tel: ${investor.phone}`, pageWidth / 2, y);
  y += 12;

  // Birds section
  const investorBirds = birds.filter(b => b.investorId === investor.id);
  if (investorBirds.length > 0) {
    doc.setTextColor(30, 27, 75);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Plantel', 14, y);
    y += 4;

    const birdRows = investorBirds.map(b => [
      `${b.species} - ${b.breed}`,
      `${b.matrixCount || 0} Matrizes / ${b.breederCount || 0} Reprodutores`,
      formatCurrency(b.investmentValue || 0),
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Especie / Raca', 'Quantidade', 'Valor Investido']],
      body: birdRows,
      theme: 'striped',
      headStyles: { fillColor: [108, 43, 217], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
    });

    y = doc.lastAutoTable.finalY + 12;
  }

  // Financial investments
  const investorFinancial = financialInvestments.filter(f => f.investorId === investor.id);
  if (investorFinancial.length > 0) {
    doc.setTextColor(30, 27, 75);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Aportes Financeiros (3% a.m. juros compostos)', 14, y);
    y += 4;

    const finRows = investorFinancial.map(f => {
      const months = getMonthsDifference(f.date, new Date().toISOString());
      const current = calculateCompoundInterest(f.amount, 0.03, months);
      return [
        formatDate(f.date),
        formatCurrency(f.amount),
        `${months} meses`,
        formatCurrency(current),
        formatCurrency(current - f.amount),
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [['Data', 'Valor Aportado', 'Periodo', 'Valor Atual', 'Rendimento']],
      body: finRows,
      theme: 'striped',
      headStyles: { fillColor: [16, 185, 129], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
    });

    y = doc.lastAutoTable.finalY + 12;
  }

  // Profit distribution with pagination (50 rows per page)
  if (distribution && distribution.items && distribution.items.length > 0) {
    const allItems = distribution.items;
    const totalPages = Math.ceil(allItems.length / ROWS_PER_PAGE);

    for (let page = 0; page < totalPages; page++) {
      if (page > 0 || y > 220) {
        doc.addPage();
        y = 20;
      }

      const startIdx = page * ROWS_PER_PAGE;
      const endIdx = Math.min(startIdx + ROWS_PER_PAGE, allItems.length);
      const pageItems = allItems.slice(startIdx, endIdx);

      doc.setTextColor(30, 27, 75);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      const pageLabel = totalPages > 1 ? ` (${page + 1}/${totalPages})` : '';
      doc.text(`Distribuicao de Lucros - Vendas${pageLabel}`, 14, y);
      y += 4;

      const saleRows = pageItems.map(item => [
        formatDate(item.date || item.importedAt),
        item.orderNumber || '-',
        item.itemDescription || item.item || '-',
        item.isEgg ? 'Ovo' : 'Ave',
        formatCurrency(item.totalValue),
        `${(item.rate * 100).toFixed(1)}%`,
        formatCurrency(item.profit),
      ]);

      autoTable(doc, {
        startY: y,
        head: [['Data', 'Pedido', 'Item', 'Tipo', 'Valor Venda', 'Taxa', 'Lucro']],
        body: saleRows,
        theme: 'striped',
        headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
        bodyStyles: { fontSize: 7 },
        columnStyles: {
          1: { cellWidth: 22 },
        },
        margin: { left: 14, right: 14 },
      });

      y = doc.lastAutoTable.finalY + 10;
    }

    // Summary
    if (y > 250) { doc.addPage(); y = 20; }

    doc.setFillColor(248, 249, 252);
    doc.roundedRect(14, y, pageWidth - 28, 40, 4, 4, 'F');

    doc.setTextColor(30, 27, 75);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Resumo dos Lucros', 20, y + 10);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Lucro com Ovos: ${formatCurrency(distribution.eggProfit)}`, 20, y + 20);
    doc.text(`Lucro com Aves: ${formatCurrency(distribution.birdProfit)}`, 20, y + 28);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total: ${formatCurrency(distribution.totalProfit)}`, pageWidth - 20, y + 24, { align: 'right' });
  }

  // Footer with page numbers
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

  // Download using blob + anchor for maximum browser compatibility
  const periodSuffix = periodLabel ? `_${periodLabel.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
  const fileName = `Relatorio_${investor.name.replace(/\s+/g, '_')}${periodSuffix}_${new Date().toISOString().slice(0, 10)}.pdf`;
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
