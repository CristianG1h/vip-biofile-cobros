import http from "node:http";
import crypto from "node:crypto";
import { config } from "./config.js";
import { logger, recentLogs } from "./logger.js";
import { createBiofileSession } from "./browser.js";
import { runDaily } from "./jobs/daily.js";
import { runWeekly } from "./jobs/weekly.js";
import { runBackfill } from "./jobs/backfill.js";
import {
  previsualizarCobro,
  signatureForPlan,
  enviarCobroConfirmado,
  normalizeDesde,
} from "./jobs/cobro.js";
import {
  pingAppsScript,
  getCobroHistoryFromAppsScript,
} from "./apps-script-client.js";
import { todayISO, weekdayInZone } from "./utils/date.js";
import { renderAdminLogin, renderAdminConsole } from "./admin-console.js";

const VERSION = "4.4.1-admin";
const ADMIN_COOKIE = "vip_cobros_admin";
const ADMIN_SESSION_HOURS = 8;
const confirmations = new Map();

const state = {
  startedAt: new Date().toISOString(),
  running: null,
  lastDailySuccessDate: "",
  lastWeeklySuccessDate: "",
  lastDailyAttemptAt: 0,
  lastWeeklyAttemptAt: 0,
  lastResult: null,
  lastError: null,
  lastCobro: null,
  lastCobroError: null,
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

function html(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(303, { location, "cache-control": "no-store" });
  res.end();
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

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function sessionSignature(expiry) {
  return crypto
    .createHmac("sha256", String(config.server.apiKey || ""))
    .update(`vip-cobros-admin|${expiry}`)
    .digest("hex");
}

function createAdminSession() {
  const expiry = Date.now() + ADMIN_SESSION_HOURS * 60 * 60 * 1000;
  return `${expiry}.${sessionSignature(expiry)}`;
}

function validAdminSession(req) {
  if (!config.server.apiKey) return false;
  const token = parseCookies(req)[ADMIN_COOKIE] || "";
  const [expiryRaw, sig] = String(token).split(".");
  const expiry = Number(expiryRaw);
  if (!expiry || expiry < Date.now() || !sig) return false;
  return safeEqual(sig, sessionSignature(expiry));
}

function authorize(req, res) {
  if (!config.server.apiKey) {
    json(res, 503, {
      ok: false,
      error: "SERVICE_API_KEY no está configurada en Render.",
    });
    return false;
  }

  if (validAdminSession(req)) return true;

  if (!safeEqual(requestApiKey(req), config.server.apiKey)) {
    json(res, 401, { ok: false, error: "No autorizado." });
    return false;
  }

  return true;
}

function cookieHeader(req, value, maxAge) {
  const forwarded = String(req.headers["x-forwarded-proto"] || "");
  const secure = forwarded.toLowerCase() === "https" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function deployedCommit() {
  return String(
    process.env.RENDER_GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    process.env.GIT_COMMIT ||
    "local"
  ).slice(0, 12);
}

function publicState() {
  return {
    service: "vip-biofile-cobros",
    version: VERSION,
    commit: deployedCommit(),
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
    lastCobro: state.lastCobro,
    lastCobroError: state.lastCobroError,
  };
}

async function readBody(req, maxBytes = 100_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Solicitud demasiado grande.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function runExclusive(kind, source, callback) {
  if (state.running) {
    throw new Error(`Ya hay una ejecución activa: ${state.running.kind}.`);
  }

  const startedAt = new Date().toISOString();
  state.running = { kind, source, startedAt };
  state.lastError = null;

  const session = await createBiofileSession();
  try {
    await session.ensureLogin();
    const result = await callback(session.page);

    state.lastResult = {
      kind,
      source,
      startedAt,
      finishedAt: new Date().toISOString(),
      result,
    };

    logger.info("Ejecución de Biofile terminada correctamente.", { kind, source });
    return result;
  } catch (error) {
    state.lastError = {
      kind,
      source,
      at: new Date().toISOString(),
      message: error.message,
    };
    logger.error("Ejecución de Biofile terminó con error.", {
      kind,
      source,
      message: error.message,
    });
    throw error;
  } finally {
    await session.close().catch(() => {});
    state.running = null;
  }
}

async function runBiofileJob(kind, source, options = {}) {
  return runExclusive(kind, source, async (page) => {
    let result;

    if (kind === "weekly") {
      result = await runWeekly(page);
    } else if (kind === "backfill") {
      result = await runBackfill(page, options);
    } else {
      result = await runDaily(page);
    }

    const dateISO = todayISO(config.timezone);
    if (kind === "weekly") state.lastWeeklySuccessDate = dateISO;
    else if (kind === "daily") state.lastDailySuccessDate = dateISO;

    return result;
  });
}

function startBackgroundJob(kind, source, options = {}) {
  if (state.running) return false;
  void runBiofileJob(kind, source, options).catch(() => {});
  return true;
}

async function runPreview(desde, source = "admin") {
  const desdeISO = normalizeDesde(desde);
  return runExclusive("cobro-preview", source, (page) =>
    previsualizarCobro(page, { desdeISO })
  );
}

async function prepareReal(desde) {
  const preview = await runPreview(desde, "admin-prepare-real");
  const confirmationId = crypto.randomUUID();
  const signature = signatureForPlan(preview.plan);
  const expiresAt = Date.now() + 10 * 60 * 1000;

  confirmations.set(confirmationId, {
    confirmationId,
    desde: preview.desde,
    hasta: preview.hasta,
    signature,
    expiresAt,
    summary: preview.plan.summary,
  });

  return { confirmationId, preview };
}

function cleanupConfirmations() {
  const now = Date.now();
  for (const [id, item] of confirmations.entries()) {
    if (item.expiresAt < now) confirmations.delete(id);
  }
}

function startConfirmedReal(confirmationId) {
  cleanupConfirmations();
  const item = confirmations.get(confirmationId);
  if (!item) throw new Error("Confirmación inválida o expirada.");

  if (state.running) {
    throw new Error("YA EXISTE UN PROCESO DE COBRO EN EJECUCIÓN");
  }

  confirmations.delete(confirmationId);

  void (async () => {
    const processId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    state.lastCobroError = null;

    try {
      const finalResult = await runExclusive(
        "cobro-real",
        "admin-confirm",
        async (page) => {
          logger.info("Revalidando cartera antes del envío real.", {
            desde: item.desde,
            filtroBiofile: "CON DEUDA",
          });

          const current = await previsualizarCobro(page, {
            desdeISO: item.desde,
          });

          const currentSignature = signatureForPlan(current.plan);
          if (!safeEqual(currentSignature, item.signature)) {
            throw new Error(
              "La cartera cambió desde la previsualización. No se envió nada; vuelve a previsualizar y confirmar."
            );
          }

          logger.info("Segunda confirmación válida. Iniciando envío real.", {
            processId,
            empresas: current.plan.summary.empresasConEnvio,
            facturas: current.plan.summary.facturasConEnvio,
            saldo: current.plan.summary.saldoAEnviar,
          });

          const sent = await enviarCobroConfirmado(current, {
            processId,
            source: "admin_console_real",
          });

          return {
            preview: current.plan.summary,
            send: sent,
          };
        }
      );

      state.lastCobro = {
        processId,
        startedAt,
        finishedAt: new Date().toISOString(),
        result: finalResult,
      };

      logger.info("Proceso de cobro real finalizado.", {
        processId,
        result: finalResult?.send?.result,
      });
    } catch (error) {
      state.lastCobroError = {
        processId,
        startedAt,
        finishedAt: new Date().toISOString(),
        message: error.message,
      };
      logger.error("Proceso de cobro real detenido.", {
        processId,
        message: error.message,
      });
    }
  })();

  return { accepted: true };
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

function parseControlledCommand(command) {
  const raw = String(command || "").trim();
  if (!raw) throw new Error("Comando vacío.");

  const parts = raw.split(/\s+/);
  const name = parts.shift().toLowerCase();
  const args = {};

  for (const part of parts) {
    const match = part.match(/^--([a-z-]+)=(.+)$/i);
    if (!match) throw new Error(`Argumento no permitido: ${part}`);
    args[match[1].toLowerCase()] = match[2];
  }

  const allowed = new Set([
    "estado",
    "consultar-cartera",
    "previsualizar-cobro",
    "iniciar-cobro",
    "ver-historial",
    "ver-logs",
  ]);

  if (!allowed.has(name)) {
    throw new Error("Comando no permitido. Esta consola no ejecuta comandos del sistema.");
  }

  return { name, args };
}

async function executeControlledCommand(command) {
  const { name, args } = parseControlledCommand(command);

  if (name === "estado") {
    return { ok: true, type: "status", ...publicState() };
  }

  if (name === "ver-logs") {
    return { ok: true, type: "logs", logs: recentLogs(150) };
  }

  if (name === "ver-historial") {
    const history = await getCobroHistoryFromAppsScript(100);
    return { ok: true, type: "history", history };
  }

  const desde = normalizeDesde(args.desde || "2026-01-01");

  if (name === "consultar-cartera") {
    const preview = await runPreview(desde, "admin-consultar");
    return {
      ok: true,
      type: "consultar",
      plan: { summary: preview.plan.summary, groups: [] },
    };
  }

  if (name === "previsualizar-cobro") {
    const preview = await runPreview(desde, "admin-preview");
    return { ok: true, type: "preview", plan: preview.plan };
  }

  if (name === "iniciar-cobro") {
    if (String(args.modo || "").toLowerCase() !== "real") {
      throw new Error('El envío real exige "--modo=real".');
    }
    const prepared = await prepareReal(desde);
    return {
      ok: true,
      type: "prepare-real",
      confirmationId: prepared.confirmationId,
      plan: prepared.preview.plan,
      expiresInSeconds: 600,
    };
  }

  throw new Error("Comando no implementado.");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/health") {
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "cache-control": "no-store",
          "x-service": "vip-biofile-cobros",
        });
        res.end();
      } else {
        json(res, 200, {
          ok: true,
          service: "vip-biofile-cobros",
          version: VERSION,
          now: new Date().toISOString(),
        });
      }
      return;
    }

    // UptimeRobot usa HEAD por defecto en monitores HTTP(S).
    // Respondemos 200 en la raíz para que el monitor no marque un falso 404.
    if (req.method === "HEAD" && url.pathname === "/") {
      res.writeHead(200, {
        "cache-control": "no-store",
        "x-service": "vip-biofile-cobros",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      redirect(res, "/admin/console");
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/console") {
      if (!validAdminSession(req)) {
        html(res, 200, renderAdminLogin());
        return;
      }
      html(res, 200, renderAdminConsole());
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin/login") {
      if (!config.server.apiKey) {
        html(res, 503, renderAdminLogin({ error: "SERVICE_API_KEY no está configurada." }));
        return;
      }

      const text = await readBody(req, 20_000);
      const params = new URLSearchParams(text);
      const key = params.get("key") || "";

      if (!safeEqual(key, config.server.apiKey)) {
        html(res, 401, renderAdminLogin({ error: "Clave inválida." }));
        return;
      }

      res.setHeader(
        "set-cookie",
        cookieHeader(req, createAdminSession(), ADMIN_SESSION_HOURS * 3600)
      );
      redirect(res, "/admin/console");
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin/logout") {
      res.setHeader("set-cookie", cookieHeader(req, "", 0));
      redirect(res, "/admin/console");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      if (!authorize(req, res)) return;
      json(res, 200, { ok: true, ...publicState() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      if (!authorize(req, res)) return;
      json(res, 200, {
        ok: true,
        logs: recentLogs(Number(url.searchParams.get("limit") || 150)),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/apps-script/ping") {
      if (!authorize(req, res)) return;
      const result = await pingAppsScript();
      json(res, 200, { ok: true, result });
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

    if (req.method === "POST" && url.pathname === "/api/sync/backfill") {
      if (!authorize(req, res)) return;
      const desdeISO = url.searchParams.get("desde") || "";
      const hastaISO = url.searchParams.get("hasta") || "";
      if (!startBackgroundJob("backfill", "api", { desdeISO, hastaISO, dryRun: false })) {
        json(res, 409, { ok: false, error: "Ya hay una ejecución activa.", running: state.running });
        return;
      }
      json(res, 202, {
        ok: true,
        accepted: true,
        job: "backfill",
        desde: desdeISO || "01/01 del año actual",
        hasta: hastaISO || "hoy",
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/command") {
      if (!authorize(req, res)) return;
      const body = await readJson(req);
      const result = await executeControlledCommand(body.command);
      json(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/cobro/confirm-real") {
      if (!authorize(req, res)) return;
      const body = await readJson(req);
      const confirmationId = String(body.confirmationId || "").trim();
      const result = startConfirmedReal(confirmationId);
      json(res, 202, { ok: true, ...result, message: "Proceso real aceptado. Revisa la consola y los logs." });
      return;
    }

    json(res, 404, { ok: false, error: "Ruta no encontrada." });
  } catch (error) {
    logger.error("Error atendiendo solicitud HTTP.", {
      method: req.method,
      url: req.url,
      message: error.message,
    });
    json(res, 500, { ok: false, error: error.message });
  }
});

server.listen(config.server.port, "0.0.0.0", () => {
  logger.info("VIP Biofile Cobros Web Service iniciado.", {
    port: config.server.port,
    version: VERSION,
    commit: deployedCommit(),
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
