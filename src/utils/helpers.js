export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);
}

// Render a rate like 0.064 as "6,4%" — pt-BR decimal comma, no trailing zeros.
export function formatPercent(rate) {
  const v = (Number(rate) || 0) * 100;
  const s = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${s.replace('.', ',')}%`;
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

// Default profit rates — the values the farm started with. They stay the
// fallback whenever no configured rate is available (legacy rows, or a portal
// rendering before appData finishes loading).
export const DEFAULT_EGG_PROFIT_RATE = 0.10;   // 10%
export const DEFAULT_BIRD_PROFIT_RATE = 0.064; // 6,4%

// Both resolvers take an optional `rates` object — in practice the appData
// slice `{ eggProfitRate, birdProfitRate }` exposed by useApp(). Calling them
// with no argument still yields the historical defaults, so any call site that
// has not been threaded through yet keeps working unchanged.
export function getEggProfitRate(rates) {
  const r = rates?.eggProfitRate;
  return typeof r === 'number' && isFinite(r) && r >= 0 ? r : DEFAULT_EGG_PROFIT_RATE;
}

export function getBirdProfitRate(rates) {
  const r = rates?.birdProfitRate;
  return typeof r === 'number' && isFinite(r) && r >= 0 ? r : DEFAULT_BIRD_PROFIT_RATE;
}

// Resolve the rate that actually applies to a given sale.
//
// Every sale stores the profitRate it was registered with, so historical rows
// keep the percentage that was in force at the time. That is precisely what
// makes "keep the history" work when the admin edits the global rates: only
// sales with no stored rate fall back to the current configuration.
export function getSaleRateInfo(sale, rates, bird) {
  const description = sale?.itemDescription || sale?.descricaoItem || sale?.item || '';
  const isEgg = typeof sale?.isEgg === 'boolean' ? sale.isEgg : isEggProduct(description);
  const stored = sale?.profitRate;
  if (typeof stored === 'number' && isFinite(stored) && stored >= 0) {
    return { isEgg, rate: stored };
  }
  return { isEgg, rate: resolveRateFor(bird, isEgg, rates) };
}

// Rate that applies to a sale of a given animal. Each bird may override the
// egg rate, the animal rate, or both — margins differ per breed. An absent or
// blank override falls back to the global configuration.
export function resolveRateFor(bird, isEgg, rates) {
  const override = isEgg ? bird?.eggProfitRate : bird?.birdProfitRate;
  if (typeof override === 'number' && isFinite(override) && override >= 0) return override;
  return isEgg ? getEggProfitRate(rates) : getBirdProfitRate(rates);
}

// True when a bird overrides at least one of the two rates.
export function hasRateOverride(bird) {
  if (!bird) return false;
  const e = bird.eggProfitRate;
  const b = bird.birdProfitRate;
  return (typeof e === 'number' && isFinite(e)) || (typeof b === 'number' && isFinite(b));
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

// ---------------------------------------------------------------------------
// Bird ownership timeline
//
// A bird belongs to one investor at a time, but that link can change hands —
// e.g. an investor absorbs an animal from another. Rather than rewriting past
// sales, each bird carries a timeline and every sale is attributed to whoever
// owned the animal ON THE SALE DATE.
//
//   bird.investorId           -> current owner
//   bird.ownershipStartDate   -> when the current owner took over ('' = always)
//   bird.ownershipEndDate     -> when the current owner's period ends ('' = open)
//   bird.ownershipHistory[]   -> previous { investorId, startDate, endDate }
//
// Dates are inclusive on both ends.
// ---------------------------------------------------------------------------

// Normalize any date-ish value to a comparable YYYY-MM-DD string. Sale dates
// arrive from CSV, pasted receipts and manual forms, so the raw value may be
// an ISO timestamp, a plain date, or a locale string.
export function normalizeDay(value) {
  if (!value) return '';
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// The day before `dayStr`. Used to close the outgoing owner's period on a
// transfer: they keep everything up to the day before the new owner starts.
export function previousDay(dayStr) {
  const day = normalizeDay(dayStr);
  if (!day) return '';
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return normalizeDay(d.toISOString());
}

// True when a bird carries an explicit ownership timeline. Birds registered
// before this feature have none and MUST keep behaving exactly as before:
// every sale credits their current investor, regardless of date.
export function hasOwnershipTimeline(bird) {
  if (!bird) return false;
  return !!(
    bird.ownershipStartDate ||
    bird.ownershipEndDate ||
    (Array.isArray(bird.ownershipHistory) && bird.ownershipHistory.length > 0)
  );
}

// Full timeline of a bird: past periods plus the current link, oldest first.
export function getOwnershipPeriods(bird) {
  if (!bird) return [];
  const past = Array.isArray(bird.ownershipHistory) ? bird.ownershipHistory : [];
  const current = {
    investorId: bird.investorId,
    startDate: bird.ownershipStartDate || '',
    endDate: bird.ownershipEndDate || '',
    current: true,
  };
  return [...past, current]
    .filter(p => p && p.investorId)
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}

// Which investor owned `bird` on `dateStr`. Returns null when the date falls
// outside every period (e.g. a sale predating the owner's start date) — those
// sales are left unattributed on purpose.
export function resolveBirdOwnerAt(bird, dateStr) {
  const periods = getOwnershipPeriods(bird);
  if (periods.length === 0) return null;
  const day = normalizeDay(dateStr);
  // No usable date on the sale: fall back to whoever owns the bird now.
  if (!day) return bird.investorId || null;
  // Latest applicable period wins, should two ranges ever overlap.
  for (let i = periods.length - 1; i >= 0; i--) {
    const p = periods[i];
    if (p.startDate && day < p.startDate) continue;
    if (p.endDate && day > p.endDate) continue;
    return p.investorId;
  }
  return null;
}

// Investor a bird-linked sale should credit on a given date. Birds with no
// timeline keep the legacy behaviour (always the current investor).
export function resolveBirdInvestorForDate(bird, dateStr) {
  if (!bird) return null;
  if (!hasOwnershipTimeline(bird)) return bird.investorId || null;
  return resolveBirdOwnerAt(bird, dateStr);
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

// Calculate profit distribution for sales.
//
// `rates` is the optional appData slice { eggProfitRate, birdProfitRate }.
// It is only consulted for sales that carry no stored profitRate — historical
// rows keep the percentage they were registered with.
export function calculateProfitDistribution(sales, birds, rates) {
  const validSales = filterValidTransactions(sales);
  const distribution = {};
  const unmatchedSales = [];
  const birdList = Array.isArray(birds) ? birds : [];

  for (const sale of validSales) {
    const description = sale.itemDescription || sale.descricaoItem || sale.item || '';
    const totalValue = parseFloat(sale.totalValue || sale.valorTotal || sale.price || sale.preco || 0);

    if (!description || totalValue <= 0) continue;

    const saleDay = normalizeDay(sale.date || sale.data || sale.importedAt);

    const linkedBird = sale.matchedBirdId
      ? birdList.find(b => b.id === sale.matchedBirdId)
      : null;

    // Each sale carries its own type + rate (set when it was registered), so
    // history is never repriced behind the admin's back. Only rows with no
    // stored rate fall back — to the linked animal's own rate when it has one,
    // otherwise to the global configuration. Manual "avulsa" sales rely on the
    // stored rate too: a custom description has no "OVO" keyword and would
    // otherwise be misclassified as an animal sale.
    const { isEgg, rate } = getSaleRateInfo(sale, rates, linkedBird);

    // Investor resolution, in priority order:
    //   1. The bird this sale is linked to, evaluated AT THE SALE DATE. This is
    //      what makes an ownership transfer re-attribute past sales correctly
    //      without rewriting a single stored row.
    //   2. The investor stored on the sale — manual "avulsa" sales, and
    //      imported sales whose bird has no ownership timeline.
    //   3. A fresh breed match, also evaluated at the sale date.
    let investorId = null;
    let breedName = sale.matchedBreed || null;

    if (linkedBird && hasOwnershipTimeline(linkedBird)) {
      investorId = resolveBirdOwnerAt(linkedBird, saleDay);
      breedName = linkedBird.breed || breedName;
    } else if (sale.matchedInvestorId) {
      investorId = sale.matchedInvestorId;
      if (linkedBird) breedName = linkedBird.breed || breedName;
    } else {
      const matchedBird = matchSaleToBird(description, birdList);
      if (matchedBird) {
        investorId = resolveBirdInvestorForDate(matchedBird, saleDay);
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

// What each animal has returned so far.
//
// Walks every valid sale once and accumulates it against the animal it is
// linked to, using exactly the same rate and ownership rules as
// calculateProfitDistribution — so the numbers on a bird card always agree
// with the investor's statement.
//
// Returns a map keyed by bird id:
//   revenue            gross value of the sales attributed to this animal
//   profit             investor profit across every owner it has ever had
//   currentOwnerProfit the slice of that profit earned by its current owner
//   eggProfit/birdProfit  profit split by sale type
//   saleCount          number of sales counted
export function calculateBirdReturns(sales, birds, rates) {
  const birdList = Array.isArray(birds) ? birds : [];
  const byBird = {};
  for (const bird of birdList) {
    byBird[bird.id] = {
      revenue: 0, profit: 0, currentOwnerProfit: 0,
      eggProfit: 0, birdProfit: 0, saleCount: 0,
    };
  }

  for (const sale of filterValidTransactions(sales)) {
    const description = sale.itemDescription || sale.descricaoItem || sale.item || '';
    const totalValue = parseFloat(sale.totalValue || sale.valorTotal || sale.price || sale.preco || 0);
    if (!description || totalValue <= 0) continue;

    // An explicit link wins; only unlinked sales get a breed match. A link
    // pointing at a deleted animal is skipped rather than re-matched, so a
    // removed bird's history never lands on an unrelated one.
    let bird = null;
    if (sale.matchedBirdId) {
      bird = birdList.find(b => b.id === sale.matchedBirdId);
      if (!bird) continue;
    } else {
      bird = matchSaleToBird(description, birdList);
    }
    if (!bird) continue;

    const acc = byBird[bird.id];
    if (!acc) continue;

    const { isEgg, rate } = getSaleRateInfo(sale, rates, bird);
    const profit = totalValue * rate;
    const owner = resolveBirdInvestorForDate(bird, normalizeDay(sale.date || sale.data || sale.importedAt));

    acc.revenue += totalValue;
    acc.saleCount += 1;
    // A sale falling outside every ownership period credits nobody, so it
    // counts as revenue but not as investor profit.
    if (owner) {
      acc.profit += profit;
      if (isEgg) acc.eggProfit += profit;
      else acc.birdProfit += profit;
      if (owner === bird.investorId) acc.currentOwnerProfit += profit;
    }
  }

  return byBird;
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


// ---------------------------------------------------------------------------
// Ornabird mirror
//
// Rows synced from Ornabird carry the flock group they came from. Invest links
// a Plantel row to a group through bird.ornabirdGroupId, which is what turns a
// mirrored tray or sale into "this belongs to investor X".
//
// `originGroupId` wins over `ornabirdGroupId` when present: a sale of chicks
// comes from a hatch group whose owner is inherited from the parent lot, and
// the sync reports both.
// ---------------------------------------------------------------------------

// Index of ornabirdGroupId -> bird, built once per render rather than scanning
// the flock for every row.
export function buildOrnabirdGroupIndex(birds) {
  const index = {};
  for (const bird of Array.isArray(birds) ? birds : []) {
    if (bird && bird.ornabirdGroupId) index[bird.ornabirdGroupId] = bird;
  }
  return index;
}

// The Plantel row a mirrored Ornabird record belongs to, or null when the
// group was never linked.
export function resolveMirrorBird(row, groupIndex) {
  if (!row) return null;
  return groupIndex[row.originGroupId] || groupIndex[row.ornabirdGroupId] || null;
}

// Coletas espelhadas do Ornabird traduzidas para a forma que as telas ja
// esperavam do cadastro manual antigo: { date, birdId, quantity, cracked }.
//
// Fica aqui, e nao dentro de uma tela, porque tres lugares somam ovos: Coleta
// de Ovos, Dashboard e Relatorios. Se cada um traduzisse do seu jeito,
// voltariamos ao problema que motivou o espelho — os mesmos ovos contados de
// formas diferentes em telas diferentes.
//
// `quantity` e o total coletado e `cracked` os trincados, entao "bons"
// continua sendo quantity - cracked em toda parte, como no cadastro antigo.
// Lotes de chocadeira espelhados do Ornabird traduzidos para a forma que
// Dashboard, Relatorios, Pintinhos e portais ja esperavam do cadastro manual
// antigo: { dateIn, status minusculo, totalEggs, totalHatched, totalInfertil,
// eggs: { birdId: qtd } }. Os campos novos do clone (lotCode, chocadeira,
// incubationDays...) seguem junto para a tela de Chocadeiras.
//
// O mapa `eggs` tinha uma entrada por ave no cadastro manual; no Ornabird um
// batch pertence a UM lote, entao vira uma entrada unica da ave vinculada —
// e vazio quando o lote nao esta vinculado no Plantel (nao pertence a
// investidor nenhum, mesma regra dos outros espelhos).
const MIRROR_BATCH_STATUS = {
  ACTIVE: 'incubating',
  HATCHED: 'hatched',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

export function mapOrnabirdIncubatorBatches(rows, birds) {
  const groupIndex = buildOrnabirdGroupIndex(birds);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const bird = resolveMirrorBird(row, groupIndex);
    const eggCount = row.eggCount ?? 0;
    return {
      id: row.id,
      dateIn: row.setDate || '',
      status: MIRROR_BATCH_STATUS[row.status] || 'incubating',
      totalEggs: eggCount,
      totalHatched: row.hatchedCount ?? 0,
      totalInfertil: row.infertileCount ?? 0,
      eggs: bird ? { [bird.id]: eggCount } : {},
      birdId: bird?.id ?? null,
      bird,
      // Nome antigo do cadastro manual, mantido para nao quebrar quem ja lia
      // (Dashboard e o rotulo do lote em Pintinhos).
      dateHatch: (row.hatchDate || '').slice(0, 10),
      // Campos do clone da tela de Chocadeiras.
      embryoLossCount: row.embryoLossCount ?? 0,
      pippedDiedCount: row.pippedDiedCount ?? 0,
      lotCode: row.lotCode ?? null,
      notes: row.notes ?? '',
      incubationDays: row.incubationDays ?? null,
      hatchDate: row.hatchDate ?? null,
      speciesName: row.speciesName ?? null,
      flockGroupTitle: row.flockGroupTitle ?? null,
      incubatorId: row.incubatorId ?? null,
      incubatorName: row.incubatorName ?? null,
      incubatorStatus: row.incubatorStatus ?? null,
      incubatorDescription: row.incubatorDescription ?? null,
      ornabirdGroupId: row.ornabirdGroupId ?? null,
      originGroupId: row.originGroupId ?? null,
    };
  });
}

export function mapOrnabirdEggCollections(rows, birds) {
  const groupIndex = buildOrnabirdGroupIndex(birds);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const bird = resolveMirrorBird(row, groupIndex);
    return {
      id: row.id,
      date: row.date,
      birdId: bird?.id ?? null,
      quantity: row.totalEggs ?? 0,
      cracked: row.crackedEggs ?? 0,
      notes: row.notes ?? '',
      flockGroupTitle: row.flockGroupTitle ?? null,
      bird,
    };
  });
}
