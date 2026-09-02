import http from "node:http";
import crypto from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { createBiofileSession } from "./browser.js";
import { runDaily } from "./jobs/daily.js";
import { runWeekly } from "./jobs/weekly.js";
import { pingAppsScript } from "./apps-script-client.js";
import { todayISO, weekdayInZone } from "./utils/date.js";

const state = {
  startedAt: new Date().toISOString(),
  running: null,
  lastDailySuccessDate: "",
  lastWeeklySuccessDate: "",
  lastDailyAttemptAt: 0,
  lastWeeklyAttemptAt: 0,
  lastResult: null,
  lastError: null,
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (!aa.length || aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function requestApiKey(req) {
  const direct = req.headers["x-api-key"];
  if (direct) return String(direct);
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function authorize(req, res) {
  if (!config.server.apiKey) {
    json(res, 503, {
      ok: false,
      error: "SERVICE_API_KEY no está configurada en Render.",
    });
    return false;
  }
  if (!safeEqual(requestApiKey(req), config.server.apiKey)) {
    json(res, 401, { ok: false, error: "No autorizado." });
    return false;
  }
  return true;
}

function publicState() {
  return {
    service: "vip-biofile-cobros",
    version: "4.1.0-web",
    timezone: config.timezone,
    scheduler: {
      enabled: config.server.schedulerEnabled,
      hour: config.server.schedulerHour,
      minute: config.server.schedulerMinute,
      weeklyDay: config.weeklyDay,
      recoveryDays: config.weeklyRecoveryDays,
    },
    startedAt: state.startedAt,
    running: state.running,
    lastDailySuccessDate: state.lastDailySuccessDate,
    lastWeeklySuccessDate: state.lastWeeklySuccessDate,
    lastResult: state.lastResult,
    lastError: state.lastError,
  };
}

async function runBiofileJob(kind, source) {
  if (state.running) {
    throw new Error(`Ya hay una ejecución activa: ${state.running.kind}.`);
  }

  const startedAt = new Date().toISOString();
  state.running = { kind, source, startedAt };
  state.lastError = null;

  const session = await createBiofileSession();
  try {
    await session.ensureLogin();
    const result = kind === "weekly"
      ? await runWeekly(session.page)
      : await runDaily(session.page);

    const dateISO = todayISO(config.timezone);
    if (kind === "weekly") state.lastWeeklySuccessDate = dateISO;
    else state.lastDailySuccessDate = dateISO;

    state.lastResult = {
      kind,
      source,
      startedAt,
      finishedAt: new Date().toISOString(),
      result,
    };

    logger.info("Ejecución del Web Service terminada correctamente.", {
      kind,
      source,
    });
    return result;
  } catch (error) {
    state.lastError = {
      kind,
      source,
      at: new Date().toISOString(),
      message: error.message,
    };
    logger.error("Ejecución del Web Service terminó con error.", {
      kind,
      source,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    await session.close().catch(() => {});
    state.running = null;
  }
}

function startBackgroundJob(kind, source) {
  if (state.running) return false;
  void runBiofileJob(kind, source).catch(() => {});
  return true;
}

function zonedClock() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date())
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );
  return {
    dateISO: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function afterScheduledTime(clock) {
  return (
    clock.hour > config.server.schedulerHour ||
    (clock.hour === config.server.schedulerHour &&
      clock.minute >= config.server.schedulerMinute)
  );
}

function retryAllowed(lastAttemptAt) {
  if (!lastAttemptAt) return true;
  const waitMs = config.server.schedulerRetryMinutes * 60 * 1000;
  return Date.now() - lastAttemptAt >= waitMs;
}

async function schedulerTick() {
  if (!config.server.schedulerEnabled || state.running) return;

  const clock = zonedClock();
  if (!afterScheduledTime(clock)) return;

  if (
    state.lastDailySuccessDate !== clock.dateISO &&
    retryAllowed(state.lastDailyAttemptAt)
  ) {
    state.lastDailyAttemptAt = Date.now();
    try {
      await runBiofileJob("daily", "scheduler");
    } catch {
      return;
    }
  }

  if (
    weekdayInZone(config.timezone) === config.weeklyDay &&
    state.lastWeeklySuccessDate !== clock.dateISO &&
    retryAllowed(state.lastWeeklyAttemptAt) &&
    !state.running
  ) {
    state.lastWeeklyAttemptAt = Date.now();
    try {
      await runBiofileJob("weekly", "scheduler");
    } catch {
      return;
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    json(res, 200, {
      ok: true,
      ...publicState(),
      now: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    if (!authorize(req, res)) return;
    json(res, 200, { ok: true, ...publicState() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/apps-script/ping") {
    if (!authorize(req, res)) return;
    try {
      const result = await pingAppsScript();
      json(res, 200, { ok: true, result });
    } catch (error) {
      json(res, 502, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync/daily") {
    if (!authorize(req, res)) return;
    if (!startBackgroundJob("daily", "api")) {
      json(res, 409, { ok: false, error: "Ya hay una ejecución activa.", running: state.running });
      return;
    }
    json(res, 202, { ok: true, accepted: true, job: "daily" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync/weekly") {
    if (!authorize(req, res)) return;
    if (!startBackgroundJob("weekly", "api")) {
      json(res, 409, { ok: false, error: "Ya hay una ejecución activa.", running: state.running });
      return;
    }
    json(res, 202, { ok: true, accepted: true, job: "weekly" });
    return;
  }

  json(res, 404, { ok: false, error: "Ruta no encontrada." });
});

server.listen(config.server.port, "0.0.0.0", () => {
  logger.info("VIP Biofile Cobros Web Service iniciado.", {
    port: config.server.port,
    timezone: config.timezone,
    schedulerEnabled: config.server.schedulerEnabled,
    schedulerAt: `${String(config.server.schedulerHour).padStart(2, "0")}:${String(config.server.schedulerMinute).padStart(2, "0")}`,
    weeklyDay: config.weeklyDay,
  });
});

const interval = setInterval(() => {
  void schedulerTick().catch((error) => {
    logger.error("Error no controlado en schedulerTick.", {
      message: error.message,
      stack: error.stack,
    });
  });
}, 60_000);

interval.unref();

setTimeout(() => {
  void schedulerTick().catch(() => {});
}, 5_000).unref();

function shutdown(signal) {
  logger.info("Cerrando Web Service.", { signal });
  clearInterval(interval);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
