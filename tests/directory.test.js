import test from "node:test";
import assert from "node:assert/strict";
import { extractEmails, normalizeCompanyName, normalizeDirectoryRow, normalizeNit } from "../src/company-directory.js";

test("normaliza NIT con espacios y símbolos", () => {
  assert.equal(normalizeNit("9 0 1.435-441"), "901435441");
});

test("extrae múltiples correos de una sola celda", () => {
  assert.deepEqual(
    extractEmails("UNO@EMPRESA.COM DOS@EMPRESA.COM; uno@empresa.com"),
    ["uno@empresa.com", "dos@empresa.com"]
  );
});

test("normaliza nombre de cliente para cruce", () => {
  assert.equal(normalizeCompanyName("ADRIANA CATERING S.A.S."), "ADRIANA CATERING SAS");
});

test("normaliza fila de directorio", () => {
  const row = normalizeDirectoryRow({
    cliente: " ADRIANA CATERING S.A.S. ",
    tipo: "NIT",
    nit: "901765759",
    dv: 2,
    correos: "A@X.COM B@X.COM",
  });
  assert.equal(row.nit, "901765759");
  assert.equal(row.dv, "2");
  assert.equal(row.correos, "a@x.com,b@x.com");
  assert.equal(row.claveCliente, "ADRIANA CATERING SAS");
});
