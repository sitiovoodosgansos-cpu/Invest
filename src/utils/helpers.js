export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);
}

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    // For date-only strings (YYYY-MM-DD), parse manually to avoid timezone shift
    const s = String(dateStr);
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return `${match[3]}/${match[2]}/${match[1]}`;
    }
    // For full ISO strings, format in UTC to avoid day shift
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.split(',')[0] || dateStr;
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
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
  if (!text) return '';
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

// Match a sale item to a bird breed (exact match only)
export function matchSaleToBird(itemDescription, birds) {
  if (!itemDescription || !birds.length) return null;
  const desc = normalize(itemDescription);

  // Only match if the breed name appears exactly in the description (case/accent insensitive)
  for (const bird of birds) {
    const breed = normalize(bird.breed);
    if (breed && desc.includes(breed)) {
      return bird;
    }
  }

  // Also check for "OVO" / "OVOS" keyword matching bird species for egg sales
  if (isEggProduct(itemDescription)) {
    for (const bird of birds) {
      const species = normalize(bird.species);
      if (species && desc.includes(species)) {
        return bird;
      }
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

// Build a duplicate-detection key for a sale. Two sales are considered
// duplicates iff they share the same order number, item description
// (normalized), total value (rounded to 2 decimals), and quantity.
// If either orderNumber or itemDescription is missing, the key is null
// and the sale is never treated as a duplicate of anything.
export function saleDedupeKey(sale) {
  if (!sale) return null;
  const orderNumber = (sale.orderNumber || '').toString().trim();
  const description = (sale.itemDescription || sale.item || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!orderNumber || !description) return null;
  const totalValue = Math.round((parseFloat(sale.totalValue) || 0) * 100) / 100;
  const quantity = parseInt(sale.quantity, 10) || 1;
  return `${orderNumber}||${description}||${totalValue}||${quantity}`;
}

// Returns { unique, duplicates } where `unique` is the first occurrence of
// each dedupe key (by importedAt ascending, i.e. oldest wins) and
// `duplicates` is every subsequent occurrence. Sales without a dedupe key
// (missing order number or description) are always kept in `unique`.
export function partitionSaleDuplicates(sales) {
  const sorted = [...sales].sort((a, b) => {
    const ta = a.importedAt || '';
    const tb = b.importedAt || '';
    return ta.localeCompare(tb);
  });
  const seen = new Map();
  const unique = [];
  const duplicates = [];
  for (const sale of sorted) {
    const key = saleDedupeKey(sale);
    if (!key) {
      unique.push(sale);
      continue;
    }
    if (seen.has(key)) {
      duplicates.push(sale);
    } else {
      seen.set(key, sale);
      unique.push(sale);
    }
  }
  return { unique, duplicates };
}

// Calculate profit distribution for sales
// Respects saved matchedInvestorId/matchedBirdId on each sale to preserve manual/import links.
// Only falls back to re-matching if no saved link exists.
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

    // Use saved match if available, otherwise try to match
    let investorId = sale.matchedInvestorId || null;
    let breedName = sale.matchedBreed || null;
    if (!investorId) {
      const matchedBird = matchSaleToBird(description, birds);
      if (matchedBird) {
        investorId = matchedBird.investorId;
        breedName = matchedBird.breed;
      }
    }

    if (investorId) {
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
        matchedBird: breedName,
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
