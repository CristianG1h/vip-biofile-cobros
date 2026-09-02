export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || "")
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/[^\d-]/g, "");
  return cleaned ? Number(cleaned) : 0;
}

export function internalState(rawState, saldo) {
  const state = normalizeText(rawState);

  // El estado de Biofile manda. No inferimos "Pagado" solamente porque
  // el saldo leído sea 0: un desplazamiento de columnas o una carga parcial
  // podría producir un falso 0 y detener cobros incorrectamente.
  if (state.includes("ANUL")) return "Anulada";
  if (state.includes("PAGO TOTAL") || state === "PAGADA") return "Pagado";
  if (state.includes("PAGO PARCIAL")) return "Pago parcial";
  if (state.includes("APROBADA") || state.includes("SIN PAGAR") || state.includes("PROCESADA")) return "Pendiente";

  // Ante un estado no reconocido, es más seguro dejarlo pendiente para
  // revisión que marcarlo como pagado por una inferencia financiera.
  return "Pendiente";
}

export function normalizeInvoice(raw) {
  const invoice = {
    fecha: String(raw.fecha || "").trim(),
    nFactura: String(raw.nFactura || raw.numero || "").trim(),
    cliente: String(raw.cliente || "").replace(/\s+/g, " ").trim(),
    estadoBiofile: String(raw.estadoBiofile || raw.estado || "").replace(/\s+/g, " ").trim(),
    valorTotal: parseMoney(raw.valorTotal ?? raw.valorTotalTexto),
    valorAbonado: parseMoney(raw.valorAbonado ?? raw.valorAbonadoTexto),
    saldoPendiente: parseMoney(raw.saldoPendiente ?? raw.saldo ?? raw.saldoTexto),
  };

  invoice.estadoInterno = internalState(invoice.estadoBiofile, invoice.saldoPendiente);
  return invoice;
}

export function validateInvoice(invoice) {
  const errors = [];
  if (!invoice.fecha) errors.push("fecha");
  if (!invoice.nFactura) errors.push("nFactura");
  if (!invoice.cliente) errors.push("cliente");
  return errors;
}

export function dedupeInvoices(invoices) {
  const map = new Map();
  for (const raw of invoices) {
    const invoice = normalizeInvoice(raw);
    if (!invoice.nFactura) continue;
    map.set(invoice.nFactura, invoice);
  }
  return [...map.values()];
}
