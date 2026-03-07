export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);
}

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr).split(',')[0] || dateStr;
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(d);
  } catch {
    return String(dateStr).split(',')[0] || dateStr;
  }
}

export function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export function isEggProduct(description) {
  if (!description) return false;
  return description.toUpperCase().includes('OVO');
}

export function getEggProfitRate() {
  return 0.10; // 10%
}

export function getBirdProfitRate() {
  return 0.064; // 6.4%
}

export function calculateCompoundInterest(principal, monthlyRate, months) {
  return principal * Math.pow(1 + monthlyRate, months);
}

export function getMonthsDifference(startDate, endDate) {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

// Match a sale item to a bird breed
export function matchSaleToBird(itemDescription, birds) {
  if (!itemDescription || !birds.length) return null;
  const desc = itemDescription.toUpperCase();

  // Try to find a matching bird by breed name
  for (const bird of birds) {
    const breedUpper = bird.breed.toUpperCase();
    if (desc.includes(breedUpper)) {
      return bird;
    }
  }

  // Try partial matching
  for (const bird of birds) {
    const words = bird.breed.toUpperCase().split(' ');
    if (words.length > 1 && words.every(w => desc.includes(w))) {
      return bird;
    }
  }

  return null;
}

export function filterValidTransactions(sales) {
  return sales.filter(sale => {
    const status = (sale.transactionStatus || sale.statusTransacao || '').toUpperCase();
    return !status.includes('RECUSAD') && !status.includes('REEMBOLSAD');
  });
}

// Calculate profit distribution for sales
export function calculateProfitDistribution(sales, birds) {
  const validSales = filterValidTransactions(sales);
  const distribution = {};
  const unmatchedSales = [];

  for (const sale of validSales) {
    const description = sale.itemDescription || sale.descricaoItem || sale.item || '';
    const totalValue = parseFloat(sale.totalValue || sale.valorTotal || sale.price || sale.preco || 0);

    if (!description || totalValue <= 0) continue;

    const isEgg = isEggProduct(description);
    const rate = isEgg ? getEggProfitRate() : getBirdProfitRate();
    const matchedBird = matchSaleToBird(description, birds);

    if (matchedBird) {
      const investorId = matchedBird.investorId;
      if (!distribution[investorId]) {
        distribution[investorId] = { eggProfit: 0, birdProfit: 0, totalProfit: 0, items: [] };
      }
      const profit = totalValue * rate;
      if (isEgg) {
        distribution[investorId].eggProfit += profit;
      } else {
        distribution[investorId].birdProfit += profit;
      }
      distribution[investorId].totalProfit += profit;
      distribution[investorId].items.push({
        ...sale,
        matchedBird: matchedBird.breed,
        isEgg,
        profit,
        rate,
      });
    } else {
      unmatchedSales.push({ ...sale, isEgg });
    }
  }

  return { distribution, unmatchedSales };
}

// Group sales by time period
export function groupSalesByPeriod(sales, period) {
  const groups = {};

  for (const sale of sales) {
    const date = new Date(sale.date || sale.data || sale.importedAt);
    let key;

    switch (period) {
      case 'daily':
        key = date.toISOString().slice(0, 10);
        break;
      case 'weekly': {
        const d = new Date(date);
        d.setDate(d.getDate() - d.getDay());
        key = d.toISOString().slice(0, 10);
        break;
      }
      case 'biweekly': {
        const day = date.getDate() <= 15 ? '01' : '16';
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${day}`;
        break;
      }
      case 'monthly':
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        break;
      case 'yearly':
        key = `${date.getFullYear()}`;
        break;
      default:
        key = date.toISOString().slice(0, 10);
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(sale);
  }

  return groups;
}
