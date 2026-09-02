import fs from "node:fs";
import path from "node:path";

function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;

  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function integer(name, fallback) {
  const value = Number(env(name, String(fallback)));
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function boolean(name, fallback = false) {
  const value = env(name, fallback ? "true" : "false").toLowerCase();
  return ["1", "true", "yes", "si", "sí"].includes(value);
}

function required(value, label) {
  if (!String(value || "").trim()) {
    throw new Error(`Falta configurar ${label}.`);
  }
  return String(value).trim();
}

function defaultAuthPath() {
  if (process.platform === "win32") {
    return path.join(process.cwd(), ".runtime", "auth.json");
  }
  return path.join("/tmp", "vip-biofile-cobros", "auth.json");
}

const usuario = env("BIOFILE_USUARIO", env("BIOFILE_USER"));
const contrasena = env("BIOFILE_CONTRASENA", env("BIOFILE_PASSWORD"));

export const config = {
  timezone: env("TIMEZONE", "America/Bogota"),
  weeklyDay: Math.max(0, Math.min(6, integer("WEEKLY_DAY", 0))),
  weeklyRecoveryDays: Math.max(0, integer("WEEKLY_RECOVERY_DAYS", 7)),
  biofile: {
    usuario,
    contrasena,
    estadoCuentasUrl: env(
      "BIOFILE_ESTADO_CUENTAS_URL",
      "https://vipso.biofile.com.co/Factura/EstadoCuentas.aspx"
    ),
    loginUrl: env(
      "BIOFILE_LOGIN_URL",
      "https://vipso.biofile.com.co/IniciarSesion.aspx?ReturnUrl=%2f"
    ),
    loginUserSelector: env("BIOFILE_LOGIN_USER_SELECTOR"),
    loginPasswordSelector: env("BIOFILE_LOGIN_PASSWORD_SELECTOR"),
    loginButtonSelector: env("BIOFILE_LOGIN_BUTTON_SELECTOR"),
  },
  browser: {
    headless: boolean("HEADLESS", true),
    timeout: integer("TIMEOUT_MS", 45000),
    authPath: env("BIOFILE_AUTH_PATH", defaultAuthPath()),
    executablePath: env("PLAYWRIGHT_EXECUTABLE_PATH"),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  },
  appsScript: {
    url: env("APPS_SCRIPT_URL"),
    token: env("APPS_SCRIPT_TOKEN"),
  },
  server: {
    port: Math.max(1, integer("PORT", 10000)),
    apiKey: env("SERVICE_API_KEY"),
    schedulerEnabled: boolean("SCHEDULER_ENABLED", true),
    schedulerHour: Math.max(0, Math.min(23, integer("SCHEDULER_HOUR", 18))),
    schedulerMinute: Math.max(0, Math.min(59, integer("SCHEDULER_MINUTE", 0))),
    schedulerRetryMinutes: Math.max(1, integer("SCHEDULER_RETRY_MINUTES", 15)),
  },
  requireBiofileCredentials() {
    return {
      usuario: required(config.biofile.usuario, "BIOFILE_USUARIO"),
      contrasena: required(config.biofile.contrasena, "BIOFILE_CONTRASENA"),
    };
  },
  requireAppsScript() {
    return {
      url: required(config.appsScript.url, "APPS_SCRIPT_URL"),
      token: required(config.appsScript.token, "APPS_SCRIPT_TOKEN"),
    };
  },
};
