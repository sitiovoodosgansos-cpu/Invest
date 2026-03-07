import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { formatCurrency, formatDate, isEggProduct, getMonthsDifference, calculateCompoundInterest } from './helpers';

export function exportInvestorReport(investor, birds, sales, financialInvestments, distribution) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(108, 43, 217);
  doc.rect(0, 0, pageWidth, 40, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Sitio Voo dos Gansos', 14, 18);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('Relatorio de Investimentos', 14, 28);
  doc.text(formatDate(new Date().toISOString()), pageWidth - 14, 28, { align: 'right' });

  let y = 52;

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

    doc.autoTable({
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

    doc.autoTable({
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

  // Profit distribution
  if (distribution && distribution.items && distribution.items.length > 0) {
    if (y > 220) { doc.addPage(); y = 20; }

    doc.setTextColor(30, 27, 75);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Distribuicao de Lucros - Vendas', 14, y);
    y += 4;

    const saleRows = distribution.items.map(item => [
      formatDate(item.date || item.importedAt),
      item.itemDescription || item.item || '-',
      item.isEgg ? 'Ovo' : 'Ave',
      formatCurrency(item.totalValue),
      `${(item.rate * 100).toFixed(1)}%`,
      formatCurrency(item.profit),
    ]);

    doc.autoTable({
      startY: y,
      head: [['Data', 'Item', 'Tipo', 'Valor Venda', 'Taxa', 'Lucro']],
      body: saleRows,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
    });

    y = doc.lastAutoTable.finalY + 10;

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

  doc.save(`Relatorio_${investor.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
