const MAX_LOGS = 300;
const recent = [];

function secretKey(key) {
  return /(password|contrasena|contraseña|token|secret|api.?key|authorization|cookie|storage.?state|credential)/i.test(
    String(key || "")
  );
}

function redactSecretsInText(value) {
  let text = String(value ?? "");
  const secrets = [
    process.env.BIOFILE_CONTRASENA,
    process.env.BIOFILE_PASSWORD,
    process.env.APPS_SCRIPT_TOKEN,
    process.env.SERVICE_API_KEY,
  ].filter((item) => String(item || "").length >= 4);

  for (const secret of secrets) {
    text = text.split(String(secret)).join("[REDACTED]");
  }
  return text;
}

function redact(value, depth = 0) {
  if (depth > 6) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redact(item, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = secretKey(key) ? "[REDACTED]" : redact(item, depth + 1);
    }
    return out;
  }

  if (typeof value === "string") return redactSecretsInText(value);
  return value;
}

function push(entry) {
  recent.push(entry);
  if (recent.length > MAX_LOGS) recent.splice(0, recent.length - MAX_LOGS);
}

function line(level, message, data) {
  const safeData = data === undefined ? undefined : redact(data);
  const at = new Date().toISOString();
  const extra = safeData === undefined ? "" : ` ${JSON.stringify(safeData)}`;
  console.log(`[${at}] [${level}] ${redactSecretsInText(message)}${extra}`);
  push({ at, level, message: redactSecretsInText(message), data: safeData });
}

export const logger = {
  info: (message, data) => line("INFO", message, data),
  warn: (message, data) => line("WARN", message, data),
  error: (message, data) => line("ERROR", message, data),
};

export function recentLogs(limit = 150) {
  const max = Math.max(1, Math.min(300, Number(limit) || 150));
  return recent.slice(-max);
}

export function redactForLog(value) {
  return redact(value);
}
