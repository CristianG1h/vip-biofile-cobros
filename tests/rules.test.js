import test from "node:test";
import assert from "node:assert/strict";
import { internalState, parseMoney, dedupeInvoices } from "../src/domain/invoice.js";
import { planSync } from "../src/domain/sync-plan.js";
import { biofileDateToISO, isoToBiofile, monthRanges } from "../src/utils/date.js";

import { baseDemoPendiente, diferencias } from "../src/jobs/project-dry.js";

test("convierte montos de Biofile", () => {
  assert.equal(parseMoney("2,618,000"), 2618000);
  assert.equal(parseMoney("140,600"), 140600);
  assert.equal(parseMoney("0"), 0);
});

test("mapea estados de cobro", () => {
  assert.equal(internalState("APROBADA", 100000), "Pendiente");
  assert.equal(internalState("PAGO PARCIAL", 50000), "Pago parcial");
  assert.equal(internalState("PAGO TOTAL", 0), "Pagado");
  assert.equal(internalState("PAGADA", 0), "Pagado");
  assert.equal(internalState("ANULADA", 0), "Anulada");
  // Protección contra falsos pagados: APROBADA nunca se vuelve Pagado solo por saldo 0.
  assert.equal(internalState("APROBADA", 0), "Pendiente");
  assert.equal(internalState("ESTADO DESCONOCIDO", 0), "Pendiente");
});

test("deduplica por N factura", () => {
  const result = dedupeInvoices([
    { fecha: "01/09/2026", nFactura: "FE-1", cliente: "A", estadoBiofile: "APROBADA", saldoPendiente: 10 },
    { fecha: "01/09/2026", nFactura: "FE-1", cliente: "A", estadoBiofile: "PAGO TOTAL", saldoPendiente: 0 }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].estadoInterno, "Pagado");
});

test("planifica INSERT y UPDATE sin duplicar", () => {
  const existing = [
    { fecha: "01/09/2026", nFactura: "FE-1", cliente: "A", estadoBiofile: "APROBADA", valorTotal: 100, valorAbonado: 0, saldoPendiente: 100 }
  ];
  const incoming = [
    { fecha: "01/09/2026", nFactura: "FE-1", cliente: "A", estadoBiofile: "PAGO PARCIAL", valorTotal: 100, valorAbonado: 40, saldoPendiente: 60 },
    { fecha: "01/09/2026", nFactura: "FE-2", cliente: "B", estadoBiofile: "APROBADA", valorTotal: 200, valorAbonado: 0, saldoPendiente: 200 }
  ];
  const plan = planSync(existing, incoming);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].after.estadoInterno, "Pago parcial");
});

test("formato de fechas compatible con Biofile", () => {
  assert.equal(isoToBiofile("2026-09-01"), "01/9/2026");
  assert.equal(biofileDateToISO("01/09/2026"), "2026-09-01");
});

test("divide una revisión larga por meses", () => {
  assert.deepEqual(monthRanges("2026-07-20", "2026-09-01"), [
    { startISO: "2026-07-20", endISO: "2026-07-31" },
    { startISO: "2026-08-01", endISO: "2026-08-31" },
    { startISO: "2026-09-01", endISO: "2026-09-01" },
  ]);
});

import { parseEstadoCuentaRows } from "../src/biofile/estado-cuentas-parser.js";

test("lee la estructura real de Estado de Cuentas de Biofile", () => {
  const headers = [
    "Fecha", "N° Factura", "Nombre del Cliente", "Estado", "Sub Total",
    "Descuento", "Vr. Iva", "Vr. Total", "Vr. Abono", "Vr. Saldo", ""
  ];

  const rows = [
    ["01/09/2026", "FE-6835", "ADRIANA CATERING S.A.S.", "APROBADA", "61,900", "0", "0", "61,900", "0", "61,900", ""],
    ["01/09/2026", "FE-6836", "ALIMENTOS GAMAR SAS", "APROBADA", "1,550,400", "0", "0", "1,550,400", "0", "1,550,400", ""],
    ["01/09/2026", "FE-6837", "ARVE SOLUCIONES SAS", "APROBADA", "335,000", "0", "0", "335,000", "0", "335,000", ""]
  ];

  const result = parseEstadoCuentaRows(rows, headers);
  assert.equal(result.length, 3);
  assert.equal(result[0].nFactura, "FE-6835");
  assert.equal(result[0].valorTotal, 61900);
  assert.equal(result[1].valorTotal, 1550400);
  assert.equal(result[2].saldoPendiente, 335000);
});

test("usa posiciones fijas si Biofile separa encabezado y datos", () => {
  const rows = [
    ["01/09/2026", "FE-6835", "ADRIANA CATERING S.A.S.", "APROBADA", "61,900", "0", "0", "61,900", "0", "61,900", ""]
  ];
  const result = parseEstadoCuentaRows(rows, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].cliente, "ADRIANA CATERING S.A.S.");
  assert.equal(result[0].estadoInterno, "Pendiente");
});


test("prueba integral puede demostrar pago semanal sin escribir", () => {
  const finalBiofile = {
    fecha: "27/08/2026",
    nFactura: "FE-6827",
    cliente: "INVERSIONES ACUINNOVA SAS",
    estadoBiofile: "PAGO TOTAL",
    valorTotal: 136000,
    valorAbonado: 136000,
    saldoPendiente: 0,
  };

  const base = baseDemoPendiente(finalBiofile);
  assert.equal(base.estadoInterno, "Pendiente");
  assert.equal(base.valorAbonado, 0);
  assert.equal(base.saldoPendiente, 136000);

  const changes = diferencias(base, {
    ...finalBiofile,
    estadoInterno: "Pagado",
  });
  assert.ok(changes.some((x) => x.includes("Estado: Pendiente -> Pagado")));
  assert.ok(changes.some((x) => x.includes("Abono: 0 -> 136000")));
  assert.ok(changes.some((x) => x.includes("Saldo: 136000 -> 0")));
});
