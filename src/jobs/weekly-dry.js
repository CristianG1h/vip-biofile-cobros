import { config } from "../config.js";
import { logger } from "../logger.js";
import { queryEstadoCuentas } from "../biofile/estado-cuentas.js";
import { isoToBiofile, minusDaysISO, monthRanges, todayISO } from "../utils/date.js";
import { dedupeInvoices } from "../domain/invoice.js";

function validarISO(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`${label} debe tener formato AAAA-MM-DD. Ejemplo: 2026-08-26`);
  }
  return value;
}

export async function runWeeklyDry(page, { desdeISO = "", hastaISO = "" } = {}) {
  const today = todayISO(config.timezone);
  const hasta = hastaISO ? validarISO(hastaISO, "--hasta") : today;
  const desde = desdeISO ? validarISO(desdeISO, "--desde") : minusDaysISO(hasta, 6);

  if (desde > hasta) {
    throw new Error(`La fecha desde (${desde}) no puede ser posterior a hasta (${hasta}).`);
  }

  logger.info("MODO PRUEBA SEMANAL BIOFILE: solo lectura; no se escribirá en Google Sheets.", {
    desde,
    hasta,
    estado: "TODAS",
    resolucion: "sin modificar",
    pageSize: 1000,
    rangoPorDefecto: !desdeISO && !hastaISO ? "últimos 7 días incluyendo hoy" : "personalizado",
  });

  const collected = [];
  for (const range of monthRanges(desde, hasta)) {
    logger.info("Consultando tramo de prueba semanal en Biofile.", range);
    const rows = await queryEstadoCuentas(page, {
      desde: isoToBiofile(range.startISO),
      hasta: isoToBiofile(range.endISO),
      daily: false,
      pageSize: 1000,
    });
    collected.push(...rows);
  }

  const invoices = dedupeInvoices(collected);
  logger.info("PRUEBA SEMANAL COMPLETADA: no se realizó ninguna escritura.", {
    invoices: invoices.length,
    desde,
    hasta,
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

  const resumen = invoices.reduce((acc, invoice) => {
    acc[invoice.estadoInterno] = (acc[invoice.estadoInterno] || 0) + 1;
    return acc;
  }, {});
  logger.info("Resumen de estados de la prueba semanal.", resumen);

  return { dryRun: true, desde, hasta, invoices, resumen };
}
