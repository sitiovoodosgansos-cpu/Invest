import Papa from 'papaparse';

// Common Wix CSV column mappings
const COLUMN_MAP = {
  // Portuguese headers - Wix Orders
  'número do pedido': 'orderNumber',
  'numero do pedido': 'orderNumber',
  'data do pedido': 'date',
  'data': 'date',
  'item': 'itemDescription',
  'nome do item': 'itemDescription',
  'descrição do item': 'itemDescription',
  'descricao do item': 'itemDescription',
  'descrição': 'itemDescription',
  'descricao': 'itemDescription',
  'produto': 'itemDescription',
  'nome do produto': 'itemDescription',
  'quantidade': 'quantity',
  'qtd': 'quantity',
  'preço': 'price',
  'preco': 'price',
  'preço unitário': 'price',
  'valor unitário': 'price',
  'valor unitario': 'price',
  'total': 'totalValue',
  'valor total': 'totalValue',
  'subtotal': 'totalValue',
  'status da transação': 'transactionStatus',
  'status da transacao': 'transactionStatus',
  'status do pagamento': 'transactionStatus',
  'comprador': 'buyerName',
  'nome do comprador': 'buyerName',
  'cliente': 'buyerName',
  // English headers
  'order number': 'orderNumber',
  'order date': 'date',
  'date': 'date',
  'item name': 'itemDescription',
  'item description': 'itemDescription',
  'product': 'itemDescription',
  'product name': 'itemDescription',
  'quantity': 'quantity',
  'qty': 'quantity',
  'price': 'price',
  'unit price': 'price',
  'total': 'totalValue',
  'total price': 'totalValue',
  'transaction status': 'transactionStatus',
  'payment status': 'transactionStatus',
  'buyer': 'buyerName',
  'buyer name': 'buyerName',
  'customer': 'buyerName',
  // Wix Payments CSV format (after dedup renaming)
  'data do pagamento': 'date',
  'data da transação': 'date',
  'data da transacao': 'date',
  'valor': 'totalValue',
  'líquido': 'netAmount',
  'liquido': 'netAmount',
  'taxa de processamento': 'fee',
  'taxa de serviço': 'serviceFee',
  'provedor de pagamento': 'paymentProvider',
  'método de pagamento': 'paymentMethod',
  'metodo de pagamento': 'paymentMethod',
  'id do pedido': 'orderNumber',
  'tipo do pedido': 'orderType',
  'nome do produto': 'itemDescription',
  'desconto': 'discount',
  'envio': 'shipping',
  'moeda': 'currency',
  'valor do reembolso': 'refundAmount',
  'nome do comprador': 'buyerName',
  'nome completo': 'buyerName',
  'nome do contato': 'buyerName',
  // English Wix Payments
  'payment amount': 'totalValue',
  'payment date': 'date',
  'payment method': 'paymentMethod',
  'payment provider': 'paymentProvider',
  'order id': 'orderNumber',
  'net amount': 'netAmount',
  'fee': 'fee',
  'currency': 'currency',
  'full name': 'buyerName',
  'contact name': 'buyerName',
};

function normalizeHeader(header) {
  return header.trim().toLowerCase()
    .replace(/[""]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*gmt\s*[+-]\d{2}:\d{2}\s*$/i, ''); // Remove GMT timezone suffix
}

function mapHeaders(headers) {
  const mapping = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (COLUMN_MAP[normalized]) {
      mapping[header] = COLUMN_MAP[normalized];
    }
  }
  return mapping;
}

function parseValue(value) {
  if (!value || typeof value !== 'string') return value;
  // Try to parse as number (handle Brazilian format R$ 1.234,56)
  const cleaned = value
    .replace(/R\$\s*/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const num = parseFloat(cleaned);
  if (!isNaN(num) && /^[\d.,R$\s-]+$/.test(value)) {
    return num;
  }
  return value.trim();
}

// Parse Brazilian date format "DD/MM/YYYY, HH:MM:SS" to ISO string
function parseBrazilianDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const str = dateStr.trim();

  // Match "DD/MM/YYYY, HH:MM:SS" or "DD/MM/YYYY HH:MM:SS"
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})[,\s]+(\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    const [, day, month, year, hour, min, sec] = match;
    return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
  }

  // Match "DD/MM/YYYY"
  const matchShort = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (matchShort) {
    const [, day, month, year] = matchShort;
    return `${year}-${month}-${day}`;
  }

  // Already ISO or other format, return as-is
  return str;
}

// Detect and preprocess Wix Payments CSV with double-header and duplicate columns
function preprocessWixPayments(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 3) return text;

  // Detect Wix Payments category header row
  const firstLine = lines[0].toLowerCase();
  const isWixPayments = (
    firstLine.includes('informações de pagamento') ||
    firstLine.includes('informacoes de pagamento') ||
    firstLine.includes('detalhes da cobrança') ||
    firstLine.includes('detalhes da cobranca') ||
    firstLine.includes('produtos ou serviços') ||
    firstLine.includes('produtos ou servicos') ||
    (firstLine.includes('"pagamento"') && firstLine.includes('"transação"'))
  );

  if (!isWixPayments) return text;

  // Remove the first category header row
  lines.shift();

  // Parse header row to deduplicate column names
  const headerResult = Papa.parse(lines[0], { header: false });
  if (headerResult.data && headerResult.data[0]) {
    const headers = headerResult.data[0];
    const count = {};
    const renamed = headers.map((h, idx) => {
      const name = h.trim();
      if (!name) return `_col_${idx}`;

      count[name] = (count[name] || 0) + 1;

      // "Nome" appears 3 times: billing name, shipping name, product name
      if (name === 'Nome') {
        if (count[name] === 1) return 'Nome do Comprador';
        if (count[name] === 2) return 'Nome Entrega';
        if (count[name] === 3) return 'Nome do Produto';
      }

      // "Sobrenome" appears 2 times: billing, shipping
      if (name === 'Sobrenome' && count[name] > 1) return 'Sobrenome Entrega';

      // "Quantidade" - make sure product quantity is mapped
      // It appears once, after product name - no dedup needed

      // "Status" appears multiple times: subscription, chargeback
      if (name === 'Status' && count[name] > 1) return `Status_${count[name]}`;

      // Other duplicates
      if (count[name] > 1) return `${name}_${count[name]}`;

      return name;
    });

    // Rebuild the header line with unique names
    lines[0] = renamed.map(h => `"${h.replace(/"/g, '""')}"`).join(',');
  }

  return lines.join('\n');
}

// Split comma-separated items into individual rows
function splitMultiItemRows(rows) {
  const expanded = [];

  for (const row of rows) {
    const description = row.itemDescription || '';
    const totalValue = parseFloat(row.totalValue) || 0;
    const totalQty = parseFloat(row.quantity) || 1;
    const shipping = parseFloat(row.shipping) || 0;
    const discount = parseFloat(row.discount) || 0;

    // Skip rows with no description or generic "Payment for order"
    if (!description || /^payment for (order|invoice)/i.test(description)) {
      expanded.push(row);
      continue;
    }

    // Split by comma, but be careful not to split inside parentheses
    // e.g., "OVO - Angola Canela (João de Barro)" has commas only between items
    const items = description.split(/,\s*(?=(?:OVO\s*-|[A-Z][a-záéíóúãõç]|Kit |Taxa |Frete|Masterclass|Ingresso|Payment))/i)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (items.length <= 1) {
      // Single item, keep as-is but subtract shipping from value for profit calc
      expanded.push({
        ...row,
        itemValue: totalValue - shipping + discount,
      });
      continue;
    }

    // Filter out non-product items (fees, shipping notes)
    const productItems = [];
    const feeItems = [];
    for (const item of items) {
      if (/^taxa\s+extra/i.test(item) || /^frete/i.test(item) || /note:/i.test(item)) {
        feeItems.push(item);
      } else {
        productItems.push(item);
      }
    }

    if (productItems.length === 0) {
      expanded.push(row);
      continue;
    }

    // Calculate per-item value: (total - shipping + discount) / number of product items
    const itemsValue = totalValue - shipping + discount;
    const perItemValue = itemsValue / productItems.length;
    const perItemQty = Math.max(1, Math.round(totalQty / productItems.length));

    for (const item of productItems) {
      expanded.push({
        ...row,
        itemDescription: item,
        totalValue: Math.round(perItemValue * 100) / 100,
        quantity: perItemQty,
        itemValue: Math.round(perItemValue * 100) / 100,
        _splitFrom: description,
        _splitCount: productItems.length,
      });
    }
  }

  return expanded;
}

export function parseCSV(text) {
  // Preprocess to handle Wix Payments double-header format
  const processedText = preprocessWixPayments(text);

  return new Promise((resolve, reject) => {
    Papa.parse(processedText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0 && results.data.length === 0) {
          reject(new Error('Erro ao processar CSV: ' + results.errors[0].message));
          return;
        }

        const headers = results.meta.fields || [];
        const headerMapping = mapHeaders(headers);

        const mapped = results.data.map(row => {
          const mappedRow = {};
          for (const [original, target] of Object.entries(headerMapping)) {
            mappedRow[target] = parseValue(row[original]);
          }
          // Keep original data too
          mappedRow._original = row;

          // Parse and normalize the date from CSV
          if (mappedRow.date) {
            mappedRow.date = parseBrazilianDate(String(mappedRow.date));
          }

          // Ensure totalValue exists
          if (!mappedRow.totalValue && mappedRow.price) {
            const qty = parseFloat(mappedRow.quantity) || 1;
            mappedRow.totalValue = parseFloat(mappedRow.price) * qty;
          }

          return mappedRow;
        });

        // Split multi-item rows into individual product lines
        const expanded = splitMultiItemRows(mapped);

        resolve(expanded);
      },
      error: (err) => reject(err),
    });
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file, 'UTF-8');
  });
}
