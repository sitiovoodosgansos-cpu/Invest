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

// Remove accents/diacritics from text for flexible matching
function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

// Calculate similarity between two strings (0 to 1)
function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  // Check if shorter is contained in longer
  if (longer.includes(shorter)) return shorter.length / longer.length;
  // Levenshtein-based similarity for short strings
  if (shorter.length <= 20) {
    const dist = levenshtein(shorter, longer);
    return 1 - dist / longer.length;
  }
  return 0;
}

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

// Match a sale item to a bird breed (fuzzy matching)
export function matchSaleToBird(itemDescription, birds) {
  if (!itemDescription || !birds.length) return null;
  const desc = normalize(itemDescription);

  // 1) Exact match (normalized, no accents)
  for (const bird of birds) {
    if (desc.includes(normalize(bird.breed))) {
      return bird;
    }
  }

  // 2) All words of breed found in description (any order)
  for (const bird of birds) {
    const words = normalize(bird.breed).split(/\s+/).filter(w => w.length > 2);
    if (words.length > 0 && words.every(w => desc.includes(w))) {
      return bird;
    }
  }

  // 3) Any significant word of breed found in description (single-word partial match)
  for (const bird of birds) {
    const words = normalize(bird.breed).split(/\s+/).filter(w => w.length >= 4);
    if (words.some(w => desc.includes(w))) {
      return bird;
    }
  }

  // 4) Fuzzy similarity: find best match above threshold
  const MIN_SIMILARITY = 0.6;
  let bestBird = null;
  let bestScore = 0;

  const descWords = desc.split(/\s+/).filter(w => w.length >= 3);

  for (const bird of birds) {
    const breedNorm = normalize(bird.breed);
    const breedWords = breedNorm.split(/\s+/).filter(w => w.length >= 3);

    // Compare each breed word against each description word
    for (const bw of breedWords) {
      for (const dw of descWords) {
        const score = similarity(bw, dw);
        if (score > bestScore && score >= MIN_SIMILARITY) {
          bestScore = score;
          bestBird = bird;
        }
      }
    }
  }

  return bestBird;
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
