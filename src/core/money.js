/** "$50.00 MXN", "$4.20 USD", "€5.00 EUR". Si la moneda no se conoce, "50 XYZ". */
export function formatMoney(amount, currency) {
  const code = String(currency || '').toUpperCase();
  try {
    const n = new Intl.NumberFormat('es-MX', { style: 'currency', currency: code || 'MXN', currencyDisplay: 'narrowSymbol' }).format(amount);
    return code ? `${n} ${code}` : n;
  } catch {
    return `${amount} ${code}`.trim();
  }
}
