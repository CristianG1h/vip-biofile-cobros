import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { normalizeDirectoryRow } from "../src/company-directory.js";
import { importDirectoryToAppsScript } from "../src/apps-script-client.js";

function headerKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function indexOfHeader(headers, alternatives) {
  const normalized = headers.map(headerKey);
  return normalized.findIndex((h) => alternatives.some((a) => h.includes(a)));
}

function parseWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("El Excel no contiene hojas.");

  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
  if (rows.length < 2) throw new Error("El Excel no contiene filas de clientes.");

  const headers = rows[0];
  const indexes = {
    cliente: indexOfHeader(headers, ["NOMBRE DEL ACUERDO COMERCIAL", "NOMBRE DEL CLIENTE"]),
    tipo: indexOfHeader(headers, ["TIPO"]),
    nit: indexOfHeader(headers, ["IDENTIFICACION DEL CLIENTE", "N DE IDENTIFICACION", "IDENTIFICACION"]),
    dv: indexOfHeader(headers, ["DV"]),
    correos: indexOfHeader(headers, ["CORREO ELECTRONICO", "CORREO"]),
  };

  for (const [field, index] of Object.entries(indexes)) {
    if (index < 0) throw new Error(`No se encontró la columna requerida para: ${field}`);
  }

  return rows
    .slice(1)
    .map((row) => normalizeDirectoryRow({
      cliente: row[indexes.cliente],
      tipo: row[indexes.tipo],
      nit: row[indexes.nit],
      dv: row[indexes.dv],
      correos: row[indexes.correos],
    }))
    .filter((row) => row.cliente && row.nit);
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    throw new Error('Uso: npm run importar:clientes -- "private/Lista-de-Clientes.xlsx"');
  }

  const filePath = path.resolve(input);
  if (!fs.existsSync(filePath)) throw new Error(`No existe el archivo: ${filePath}`);

  const rows = parseWorkbook(filePath);
  const multipleEmails = rows.filter((row) => row.correos.includes(",")).length;
  const noEmail = rows.filter((row) => !row.correos).length;

  console.log(`Clientes leídos del Excel: ${rows.length}`);
  console.log(`Clientes con múltiples correos: ${multipleEmails}`);
  console.log(`Clientes sin correo: ${noEmail}`);

  const result = await importDirectoryToAppsScript(rows, {
    sourceFile: path.basename(filePath),
    importedAt: new Date().toISOString(),
  });

  console.log("Directorio enviado a Apps Script correctamente:");
  console.log(result);
}

main().catch((error) => {
  console.error("ERROR importando clientes:", error.message);
  process.exitCode = 1;
});
