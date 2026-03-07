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
  'valor': 'totalValue',
  'líquido': 'netAmount',
  'taxa de processamento': 'fee',
  'taxa de serviço': 'serviceFee',
  'provedor de pagamento': 'paymentProvider',
  'método de pagamento': 'paymentMethod',
  'metodo de pagamento': 'paymentMethod',
  'id do pedido': 'orderNumber',
  'tipo do pedido': 'orderType',
  'nome do produto': 'itemDescription',
  'quantidade do produto': 'quantity',
  'desconto': 'discount',
  'envio': 'shipping',
  'moeda': 'currency',
  'valor do reembolso': 'refundAmount',
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
      if (name === 'Sobrenome' && count[name] > 1) return `Sobrenome Entrega`;

      // "Status" appears multiple times: subscription, chargeback
      if (name === 'Status' && count[name] > 1) return `Status_${count[name]}`;

      // Other duplicates: Endereço, Rua, Número, Cidade, etc.
      if (count[name] > 1) return `${name}_${count[name]}`;

      return name;
    });

    // Rebuild the header line with unique names
    lines[0] = renamed.map(h => `"${h.replace(/"/g, '""')}"`).join(',');
  }

  return lines.join('\n');
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

          // Ensure totalValue exists
          if (!mappedRow.totalValue && mappedRow.price) {
            const qty = parseFloat(mappedRow.quantity) || 1;
            mappedRow.totalValue = parseFloat(mappedRow.price) * qty;
          }

          return mappedRow;
        });

        resolve(mapped);
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
