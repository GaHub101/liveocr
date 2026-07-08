// Kleiner Logger mit Levels error|warn|info|debug.
// Standard = info; per --debug / DEBUG=1 → debug.
//
// WICHTIG: Niemals Credentials oder Cookie-WERTE loggen – nur Cookie-Namen,
// HTTP-Codes, Selektor-/Regex-Treffer (gleiche Regel wie serverseitig).

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

let currentLevel = LEVELS.info;

export function setLevel(name) {
  if (name in LEVELS) currentLevel = LEVELS[name];
}

export function isDebug() {
  return currentLevel >= LEVELS.debug;
}

function ts() {
  return new Date().toISOString();
}

function emit(level, scope, msg) {
  if (LEVELS[level] > currentLevel) return;
  const line = `[${ts()}] [${level.toUpperCase()}] ${scope}: ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  error: (scope, msg) => emit('error', scope, msg),
  warn:  (scope, msg) => emit('warn', scope, msg),
  info:  (scope, msg) => emit('info', scope, msg),
  debug: (scope, msg) => emit('debug', scope, msg),
};
