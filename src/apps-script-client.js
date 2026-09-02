import { config } from "./config.js";
import { logger } from "./logger.js";

async function callAppsScript(action, payload = {}) {
  const { url, token } = config.requireAppsScript();

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, token, ...payload }),
    redirect: "follow",
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script devolvió una respuesta no JSON: ${text.slice(0, 300)}`);
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Apps Script respondió HTTP ${response.status}.`);
  }

  logger.info("Apps Script respondió correctamente.", { action });
  return data.data ?? data.resultado ?? data;
}

export function syncDailyToAppsScript(invoices, meta = {}) {
  return callAppsScript("sync_daily", { invoices, meta });
}

export function getWeeklyContext() {
  return callAppsScript("weekly_context");
}

export function syncWeeklyToAppsScript(invoices, meta = {}) {
  return callAppsScript("sync_weekly", { invoices, meta });
}

export function syncBackfillToAppsScript(invoices, meta = {}) {
  return callAppsScript("sync_backfill", { invoices, meta });
}

export function importDirectoryToAppsScript(rows, meta = {}) {
  return callAppsScript("import_directory", { rows, meta });
}

export function pingAppsScript() {
  return callAppsScript("ping");
}
