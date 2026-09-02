function line(level, message, data) {
  const extra = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  console.log(`[${new Date().toISOString()}] [${level}] ${message}${extra}`);
}

export const logger = {
  info: (message, data) => line("INFO", message, data),
  warn: (message, data) => line("WARN", message, data),
  error: (message, data) => line("ERROR", message, data),
};
