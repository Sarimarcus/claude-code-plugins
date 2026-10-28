import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI_VERSION = '1.11.0';

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

/** Defaults <- <root>/cwv.config.json (or --config) <- CLI overrides. */
export function loadConfig({ root, configPath, overrides = {} }) {
  const defaults = readJson(path.join(PLUGIN_ROOT, 'data', 'defaults.json'));
  const file = configPath ? path.resolve(configPath) : path.join(root, 'cwv.config.json');
  let user = {};
  if (fs.existsSync(file)) user = readJson(file);
  else if (configPath) throw new Error(`config file not found: ${file}`);
  const config = deepMerge(deepMerge(defaults, user), overrides);
  config.protectedGlobs = [...new Set([...defaults.protectedGlobs, ...(user.protectedGlobs || [])])];
  config.configFile = fs.existsSync(file) ? file : null;
  config.root = root;
  return config;
}

/** Relative paths in the config resolve against the config file's folder, else the root. */
export function resolveFrom(config, p) {
  if (!p) return p;
  if (path.isAbsolute(p)) return p;
  const base = config.configFile ? path.dirname(config.configFile) : config.root;
  return path.resolve(base, p);
}
