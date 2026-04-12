import * as pdfjsLib from 'pdfjs-dist';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

/**
 * Extract text from a PDF file (ArrayBuffer)
 */
async function extractTextFromPDF(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    pages.push(text);
  }

  return pages.join('\n');
}

/**
 * Parse a Wix order PDF text into sale items
 * Expected format:
 *   Pedido XXXXX (N itens)
 *   Nome, email, telefone
 *   Feito em DD de MMM. de YYYY, HH:MM
 *   ITEM R$ preço xQTD R$ total
 *   ...
 *   Itens R$ subtotal
 *   Frete R$ frete
 *   Cupom ... -R$ desconto
 *   Total R$ total
 */
/**
 * Parse multiple Wix orders from a single text block.
 * Splits by "Pedido XXXXX" boundaries and parses each individually.
 * Supports up to 50 orders pasted at once.
 */
export function parseWixOrderText(text) {
  // Split text into individual orders by "Pedido XXXXX" boundaries
  const orderChunks = splitOrderChunks(text);

  if (orderChunks.length <= 1) {
    // Single order (or no clear boundary) – parse as before
    return parseSingleOrder(text);
  }

  // Multiple orders – parse each and merge results
  const allItems = [];
  const orders = [];
  let totalShipping = 0;
  let totalDiscount = 0;

  for (const chunk of orderChunks) {
    const parsed = parseSingleOrder(chunk);
    orders.push({
      orderNumber: parsed.orderNumber,
      buyerName: parsed.buyerName,
      date: parsed.date,
      itemCount: parsed.items.length,
    });
    allItems.push(...parsed.items);
    totalShipping += parsed.shipping;
    totalDiscount += parsed.discount;
  }

  return {
    orderNumber: orders.map(o => o.orderNumber).filter(Boolean).join(', '),
    buyerName: '',
    date: '',
    items: allItems,
    subtotal: allItems.reduce((s, r) => s + r.totalValue, 0),
    shipping: totalShipping,
    discount: totalDiscount,
    total: allItems.reduce((s, r) => s + r.totalValue, 0) + totalShipping - totalDiscount,
    multipleOrders: true,
    orderCount: orders.length,
    orderSummary: orders,
  };
}

/**
 * Split pasted text into individual order chunks based on "Pedido XXXXX" pattern
 */
function splitOrderChunks(text) {
  // Find all positions where "Pedido XXXXX" appears
  const orderStarts = [];
  const regex = /Pedido\s+\d+/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    orderStarts.push(m.index);
  }

  if (orderStarts.length <= 1) {
    return [text];
  }

  const chunks = [];
  for (let i = 0; i < orderStarts.length; i++) {
    const start = orderStarts[i];
    const end = i + 1 < orderStarts.length ? orderStarts[i + 1] : text.length;
    chunks.push(text.slice(start, end));
  }

  return chunks;
}

/**
 * Parse a single Wix order text block
 */
function parseSingleOrder(text) {
  const results = [];

  // Extract order number
  const orderMatch = text.match(/Pedido\s+(\d+)/i);
  const orderNumber = orderMatch ? orderMatch[1] : '';

  // Extract buyer name
  const buyerMatch = text.match(/Pedido\s+\d+\s*\(\d+\s*ite[mn]s?\)\s*([A-ZÀ-Úa-zà-ú\s]+?)(?:,|\s+\S+@)/);
  const buyerName = buyerMatch ? buyerMatch[1].trim() : '';

  // Extract date - "Feito em DD de MMM. de YYYY, HH:MM"
  const monthMap = {
    'jan': '01', 'fev': '02', 'mar': '03', 'abr': '04',
    'mai': '05', 'jun': '06', 'jul': '07', 'ago': '08',
    'set': '09', 'out': '10', 'nov': '11', 'dez': '12',
  };
  const dateMatch = text.match(/Feito\s+em\s+(\d{1,2})\s+de\s+(\w{3})\.?\s+de\s+(\d{4})/i);
  let date = '';
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const month = monthMap[dateMatch[2].toLowerCase()] || '01';
    const year = dateMatch[3];
    date = `${year}-${month}-${day}`;
  }

  // Extract shipping cost
  const freteMatch = text.match(/Frete\s+R\$\s*([\d.,]+)/i);
  const frete = freteMatch ? parseBRL(freteMatch[1]) : 0;

  // Extract discount
  const discountMatch = text.match(/[-–]\s*R\$\s*([\d.,]+)\s*(?:Total|Pago)/i)
    || text.match(/Cupom[^-]*-\s*R\$\s*([\d.,]+)/i);
  const discount = discountMatch ? parseBRL(discountMatch[1]) : 0;

  // Normalize: collapse newlines into spaces so multi-line item names are
  // joined. BUT first strip the order header block entirely — both the
  // "Pedido XXXXX (N itens) [nome]" line AND the "Feito em DD de MMM. de
  // YYYY, HH:MM [para <loja>]" line. The order number, buyer name and
  // date were already captured above against the raw `text`, so they're
  // safe to strip here.
  //
  // If we leave the header in the text, collapsing newlines merges it
  // into the first item's description — e.g. "Pedido 10001 (5 itens) para
  // Sitio Voo dos Gansos Peru Bronze". The older workaround only handled
  // OVO-prefixed items because it relied on an "OVO" lookahead; bird
  // orders that started with "Peru", "Brahma", etc. fell through and got
  // polluted.
  //
  // For the Feito line we match both shapes Wix emits: the "para X"
  // suffix on the same line as "Feito em...", AND on a standalone line
  // immediately after (some PDF extractions split the header in two).
  let normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*Pedido\s+\d+[^\n]*\n?/gim, '')
    .replace(
      /^[ \t]*Feito\s+em\s+[^\n]*(?:\n[ \t]*para\s+[^\n]*)?\n?/gim,
      ''
    )
    .replace(/(?<!\n)\n(?!\n)/g, ' ');

  // Remove "Sexo:" prefix so gender info (Casal/Macho/Fêmea) merges into item description
  normalized = normalized.replace(/\bSexo:\s*/gi, '');

  // Extract line items using a general regex that captures any text before "R$ price xQTY R$ total"
  // This handles both OVO items and bird items (Brahma, Sedosa, etc.)
  // Note: \w doesn't match accented chars (ê,ã,ç,etc), so we add À-ÿ explicitly
  const itemRegex = /([A-ZÀ-ÿa-zà-ÿ][\wÀ-ÿ\s\-–(),.]*?)\s+R\$\s*([\d.,]+)\s*x\s*(\d+)\s+R\$\s*([\d.,]+)/g;

  let match;
  while ((match = itemRegex.exec(normalized)) !== null) {
    let itemDescription = match[1].trim();
    // Skip summary lines
    if (/^(Itens|Frete|Imposto|Cupom|Total|Pago|Subtotal)/i.test(itemDescription)) continue;

    const unitPrice = parseBRL(match[2]);
    let quantity = parseInt(match[3], 10);
    const totalValue = parseBRL(match[4]);

    // Detect and handle gender suffix (Casal = 2 birds, Macho/Fêmea = 1 bird)
    let gender = '';
    const genderMatch = itemDescription.match(/\s+(Casal|Macho|F[eê]mea)\s*$/i);
    if (genderMatch) {
      gender = genderMatch[1];
      itemDescription = itemDescription.replace(/\s+(Casal|Macho|F[eê]mea)\s*$/i, '').trim();
      if (gender.toLowerCase() === 'casal') {
        quantity = quantity * 2;
      }
    }

    results.push({
      orderNumber,
      buyerName,
      date,
      itemDescription,
      price: unitPrice,
      quantity,
      totalValue,
      ...(gender ? { gender } : {}),
      shipping: 0,
      discount: 0,
      transactionStatus: 'Pago',
    });
  }

  // Distribute discount proportionally across items
  if (discount > 0 && results.length > 0) {
    const subtotal = results.reduce((s, r) => s + r.totalValue, 0);
    for (const item of results) {
      const proportion = item.totalValue / subtotal;
      item.discount = Math.round(discount * proportion * 100) / 100;
    }
  }

  return {
    orderNumber,
    buyerName,
    date,
    items: results,
    subtotal: results.reduce((s, r) => s + r.totalValue, 0),
    shipping: frete,
    discount,
    total: results.reduce((s, r) => s + r.totalValue, 0) + frete - discount,
  };
}

/**
 * Parse BRL currency string: "1.234,56" -> 1234.56
 */
function parseBRL(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
}

/**
 * Read a PDF File and parse Wix order data
 */
export async function parsePDFFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const text = await extractTextFromPDF(arrayBuffer);
  return parseWixOrderText(text);
}

/**
 * Read PDF file as ArrayBuffer
 */
export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
  });
}
