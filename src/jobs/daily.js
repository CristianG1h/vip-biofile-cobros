import { config } from "../config.js";
import { logger } from "../logger.js";
import { queryEstadoCuentas } from "../biofile/estado-cuentas.js";
import { syncDailyToAppsScript } from "../apps-script-client.js";
import { isoToBiofile, todayISO } from "../utils/date.js";

export async function runDaily(page, { dryRun = false, isoDate = "" } = {}) {
  const dateISO = isoDate || todayISO(config.timezone);
  const biofileDate = isoToBiofile(dateISO);

  logger.info("Iniciando revisión diaria.", {
    dateISO,
    dryRun,
    rule: "Fecha hoy -> hoy, Estado TODAS, Resolución sin tocar, 50 registros sin tocar",
  });

  const invoices = await queryEstadoCuentas(page, {
    desde: biofileDate,
    hasta: biofileDate,
    daily: true,
    pageSize: null,
  });

  if (dryRun) {
    logger.info("MODO PRUEBA BIOFILE: no se escribirá nada en Google Sheets.", {
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

  const result = await syncDailyToAppsScript(invoices, {
    dateISO,
    source: "biofile_estado_cuentas",
  });

  logger.info("Revisión diaria enviada a Apps Script.", {
    invoices: invoices.length,
    result,
  });
  return { dryRun: false, invoices, result };
}
