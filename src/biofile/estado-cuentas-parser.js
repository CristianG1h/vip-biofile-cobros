import { normalizeInvoice, validateInvoice } from "../domain/invoice.js";

const FALLBACK_POSITIONS = Object.freeze({
  fecha: 0,
  factura: 1,
  cliente: 2,
  estado: 3,
  total: 7,
  abono: 8,
  saldo: 9,
});

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function norm(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function derivePositions(headers = []) {
  const normalized = headers.map(norm);
  const find = (needles) => normalized.findIndex((header) => needles.some((needle) => header.includes(needle)));

  const detected = {
    fecha: find(["FECHA"]),
    factura: find(["N° FACTURA", "Nº FACTURA", "N FACTURA"]),
    cliente: find(["NOMBRE DEL CLIENTE"]),
    estado: find(["ESTADO"]),
    total: find(["VR. TOTAL", "VR TOTAL"]),
    abono: find(["VR. ABONO", "VR ABONO"]),
    saldo: find(["VR. SALDO", "VR SALDO"]),
  };

  const complete = Object.values(detected).every((index) => Number.isInteger(index) && index >= 0);
  return complete ? detected : { ...FALLBACK_POSITIONS };
}

export function parseEstadoCuentaRows(cellRows = [], headers = []) {
  const positions = derivePositions(headers);
  const valid = [];

  for (const cellsRaw of cellRows) {
    const cells = Array.isArray(cellsRaw) ? cellsRaw.map(clean) : [];
    if (cells.length < 10) continue;

    const raw = {
      fecha: cells[positions.fecha] || "",
      nFactura: cells[positions.factura] || "",
      cliente: cells[positions.cliente] || "",
      estadoBiofile: cells[positions.estado] || "",
      valorTotalTexto: cells[positions.total] || "0",
      valorAbonadoTexto: cells[positions.abono] || "0",
      saldoTexto: cells[positions.saldo] || "0",
    };

    const invoice = normalizeInvoice(raw);
    const errors = validateInvoice(invoice);
    if (!errors.length) valid.push(invoice);
  }

  return valid;
}

export { FALLBACK_POSITIONS };
