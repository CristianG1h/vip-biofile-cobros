export function normalizeCompanyName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeNit(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function extractEmails(value) {
  const matches = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

export function normalizeDirectoryRow(raw = {}) {
  return {
    cliente: String(raw.cliente || "").replace(/\s+/g, " ").trim(),
    tipo: String(raw.tipo || "").trim(),
    nit: normalizeNit(raw.nit),
    dv: String(raw.dv ?? "").replace(/\D/g, ""),
    correos: extractEmails(raw.correos).join(","),
    claveCliente: normalizeCompanyName(raw.cliente),
  };
}
