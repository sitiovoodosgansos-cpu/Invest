import Papa from 'papaparse';

// Common Wix CSV column mappings
const COLUMN_MAP = {
  // Portuguese headers
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
  'status': 'transactionStatus',
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
};

function normalizeHeader(header) {
  return header.trim().toLowerCase().replace(/[""]/g, '').replace(/\s+/g, ' ');
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

export function parseCSV(text) {
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
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
