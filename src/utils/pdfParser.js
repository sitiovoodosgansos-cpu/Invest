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
export function parseWixOrderText(text) {
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

  // Extract line items: "ITEM R$ price xQTY R$ total"
  // Pattern: product name, then R$ unit price, then xN quantity, then R$ line total
  const itemRegex = /((?:OVO|Ave|Kit|Ingresso|Masterclass|Galinha|Faisão|Pavão|Pato|Marreco|Peru|Ganso|Codorna)[^\n]*?)\s+R\$\s*([\d.,]+)\s*x\s*(\d+)\s+R\$\s*([\d.,]+)/gi;

  let match;
  while ((match = itemRegex.exec(text)) !== null) {
    const itemDescription = match[1].trim();
    const unitPrice = parseBRL(match[2]);
    const quantity = parseInt(match[3], 10);
    const totalValue = parseBRL(match[4]);

    results.push({
      orderNumber,
      buyerName,
      date,
      itemDescription,
      price: unitPrice,
      quantity,
      totalValue,
      shipping: 0, // shipping is separate, not per-item
      discount: 0,
      transactionStatus: 'Pago',
    });
  }

  // If no items found with the strict pattern, try a more lenient one
  if (results.length === 0) {
    // Try: "description R$ XX,XX xN R$ XX,XX" without requiring keyword prefix
    const lenientRegex = /([A-ZÀ-Úa-zà-ú][\w\s\-–()]+?)\s+R\$\s*([\d.,]+)\s*x\s*(\d+)\s+R\$\s*([\d.,]+)/g;
    while ((match = lenientRegex.exec(text)) !== null) {
      const itemDescription = match[1].trim();
      // Skip non-product lines
      if (/^(Itens|Frete|Imposto|Cupom|Total|Pago|Subtotal)/i.test(itemDescription)) continue;

      const unitPrice = parseBRL(match[2]);
      const quantity = parseInt(match[3], 10);
      const totalValue = parseBRL(match[4]);

      results.push({
        orderNumber,
        buyerName,
        date,
        itemDescription,
        price: unitPrice,
        quantity,
        totalValue,
        shipping: 0,
        discount: 0,
        transactionStatus: 'Pago',
      });
    }
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
