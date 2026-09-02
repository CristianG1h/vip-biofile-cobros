import { config } from "../config.js";
import { logger } from "../logger.js";
import { queryEstadoCuentas } from "../biofile/estado-cuentas.js";
import { syncBackfillToAppsScript } from "../apps-script-client.js";
import { monthRanges, isoToBiofile, todayISO } from "../utils/date.js";
import { dedupeInvoices } from "../domain/invoice.js";

function defaultStartISO() {
  const today = todayISO(config.timezone);
  return `${today.slice(0, 4)}-01-01`;
}

export async function runBackfill(
  page,
  { desdeISO = "", hastaISO = "", dryRun = false } = {}
) {
  const startISO = desdeISO || defaultStartISO();
  const endISO = hastaISO || todayISO(config.timezone);
  const ranges = monthRanges(startISO, endISO);

  if (!ranges.length) {
    throw new Error(`Rango histórico inválido: ${startISO} -> ${endISO}`);
  }

  logger.info("Iniciando sincronización histórica de Biofile.", {
    desde: startISO,
    hasta: endISO,
    dryRun,
    estado: "TODAS",
    pageSize: 1000,
  });

  const collected = [];

  for (const range of ranges) {
    logger.info("Consultando tramo histórico en Biofile.", range);
    const rows = await queryEstadoCuentas(page, {
      desde: isoToBiofile(range.startISO),
      hasta: isoToBiofile(range.endISO),
      daily: false,
      pageSize: 1000,
    });
    collected.push(...rows);
  }

  const invoices = dedupeInvoices(collected);

  if (dryRun) {
    logger.info("MODO PRUEBA HISTÓRICO: no se escribirá en Google Sheets.", {
      invoices: invoices.length,
    });
    console.table(
      invoices.map((x) => ({
        Fecha: x.fecha,
        Factura: x.nFactura,
        Cliente: x.cliente,
        Estado: x.estadoBiofile,
        Total: x.valorTotal,
        Abono: x.valorAbonado,
        Saldo: x.saldoPendiente,
        Interno: x.estadoInterno,
      }))
    );
    return { dryRun: true, invoices };
  }

  const result = await syncBackfillToAppsScript(invoices, {
    desde: startISO,
    hasta: endISO,
    source: "biofile_estado_cuentas_historico",
  });

  logger.info("Sincronización histórica enviada a Apps Script.", {
    invoices: invoices.length,
    result,
  });

  return { dryRun: false, invoices, result };
}
