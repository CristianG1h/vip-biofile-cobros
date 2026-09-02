import { config } from "../config.js";
import { logger } from "../logger.js";
import { queryEstadoCuentas } from "../biofile/estado-cuentas.js";
import { getWeeklyContext, syncWeeklyToAppsScript } from "../apps-script-client.js";
import {
  biofileDateToISO,
  isoToBiofile,
  minusDaysISO,
  monthRanges,
  todayISO,
} from "../utils/date.js";
import { dedupeInvoices } from "../domain/invoice.js";

export async function runWeekly(page) {
  const context = await getWeeklyContext();
  const oldestDate = String(context.oldestDate || "").trim();
  const openInvoices = Array.isArray(context.openInvoices) ? context.openInvoices.map(String) : [];

  if (!oldestDate || !openInvoices.length) {
    logger.info("No hay facturas abiertas para revisar semanalmente.", {
      oldestDate,
      openInvoices: openInvoices.length,
    });
    return { skipped: true };
  }

  const today = todayISO(config.timezone);
  const recoverySince = minusDaysISO(today, config.weeklyRecoveryDays);
  const openSet = new Set(openInvoices);
  const collected = [];

  logger.info("Iniciando revisión semanal de facturas abiertas.", {
    oldestDate,
    today,
    openInvoices: openSet.size,
    pageSize: 1000,
    estado: "TODAS",
  });

  for (const range of monthRanges(oldestDate, today)) {
    logger.info("Consultando tramo mensual en Biofile.", range);
    const rows = await queryEstadoCuentas(page, {
      desde: isoToBiofile(range.startISO),
      hasta: isoToBiofile(range.endISO),
      daily: false,
      pageSize: 1000,
    });
    collected.push(...rows);
  }

  const unique = dedupeInvoices(collected);
  const selected = unique.filter((invoice) => {
    if (openSet.has(invoice.nFactura)) return true;
    const invoiceISO = biofileDateToISO(invoice.fecha);
    return invoiceISO && invoiceISO >= recoverySince;
  });

  const seen = new Set(selected.map((x) => x.nFactura));
  const missingOpen = [...openSet].filter((number) => !seen.has(number));

  if (missingOpen.length) {
    logger.warn("Hay facturas abiertas del Sheet que no aparecieron en la consulta de Biofile.", {
      count: missingOpen.length,
      sample: missingOpen.slice(0, 10),
    });
  }

  const result = await syncWeeklyToAppsScript(selected, {
    oldestDate,
    today,
    recoverySince,
    queried: unique.length,
    openExpected: openSet.size,
    missingOpen,
  });

  logger.info("Revisión semanal terminada.", {
    queried: unique.length,
    sent: selected.length,
    missingOpen: missingOpen.length,
    result,
  });

  return { skipped: false, queried: unique.length, sent: selected.length, missingOpen, result };
}
