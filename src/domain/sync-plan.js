import { normalizeInvoice } from "./invoice.js";

function comparable(i) {
  return JSON.stringify({
    total: Number(i.valorTotal || 0),
    abonado: Number(i.valorAbonado || 0),
    saldo: Number(i.saldoPendiente || 0),
    estado: i.estadoInterno,
    cliente: i.cliente,
  });
}

export function planSync(existingInvoices, biofileInvoices) {
  const existing = new Map(
    existingInvoices.map((i) => {
      const normalized = normalizeInvoice(i);
      return [normalized.nFactura, normalized];
    })
  );

  const inserts = [];
  const updates = [];
  const unchanged = [];

  for (const raw of biofileInvoices) {
    const incoming = normalizeInvoice(raw);
    const current = existing.get(incoming.nFactura);

    if (!current) {
      inserts.push(incoming);
      continue;
    }

    if (comparable(current) !== comparable(incoming)) {
      updates.push({ before: current, after: incoming });
    } else {
      unchanged.push(incoming);
    }
  }

  return { inserts, updates, unchanged };
}
