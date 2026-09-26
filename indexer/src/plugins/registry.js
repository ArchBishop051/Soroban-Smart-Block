import { logger } from "../logger.js";
/**
 * Decoder plugin registry (#900).
 *
 * Plugins live in DECODER_PLUGINS_DIR (default: indexer/plugins), one
 * directory each:
 *
 *   <dir>/<plugin>/manifest.json   { name, version, entry, matchers: [{ contract_id?, function? }] }
 *   <dir>/<plugin>/<entry>          CommonJS-style source: module.exports.decode = (event, helpers) => ({ description, function? })
 *
 * A plugin is loaded only if the sha256 of its entry source matches the
 * maintainer allowlist (<dir>/allowlist.json: { "<name>@<version>": "<sha256>" }),
 * and it is only invoked for events matching one of its manifest matchers.
 * Every call runs in a PluginSandbox. Violations (timeout, memory, output
 * size, thrown errors, malformed output) are reported through `onViolation`
 * (the decoder sends them to the dead-letter queue), and a plugin is disabled
 * after `violationLimit` violations.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PluginSandbox, PluginViolation } from "./sandbox.js";
import { validatePluginOutput } from "../decoderValidator.js";

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../plugins");

export const sha256 = (source) => crypto.createHash("sha256").update(source).digest("hex");

function matches(plugin, event) {
  return plugin.manifest.matchers.some(
    (m) =>
      (m.contract_id === undefined || m.contract_id === event.contract_id) &&
      (m.function === undefined || m.function === event.function),
  );
}

export class PluginRegistry {
  constructor({ violationLimit = 3, sandboxOptions = {}, onViolation = () => {} } = {}) {
    this.plugins = [];
    this.violationLimit = violationLimit;
    this.sandboxOptions = sandboxOptions;
    this.onViolation = onViolation;
  }

  /**
   * Register a plugin after checking it against the allowlist.
   * @returns {boolean} whether the plugin was registered
   */
  add(manifest, source, allowlist) {
    const id = `${manifest.name}@${manifest.version}`;
    if (!Array.isArray(manifest.matchers) || manifest.matchers.length === 0) {
      logger.warn(`[plugins] ${id} skipped: manifest declares no matchers`);
      return false;
    }
    if (allowlist?.[id] !== sha256(source)) {
      logger.warn(`[plugins] ${id} skipped: not on the allowlist or source hash mismatch`);
      return false;
    }
    this.plugins.push({ id, manifest, sandbox: new PluginSandbox(source, this.sandboxOptions), violations: 0, disabled: false });
    return true;
  }

  /** Load every allowlisted plugin from `dir`. Missing dir → no plugins. */
  loadDirectory(dir = process.env.DECODER_PLUGINS_DIR || DEFAULT_DIR) {
    if (!fs.existsSync(dir)) return this;
    const allowlistPath = path.join(dir, "allowlist.json");
    const allowlist = fs.existsSync(allowlistPath) ? JSON.parse(fs.readFileSync(allowlistPath, "utf8")) : {};
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, entry.name, "manifest.json"), "utf8"));
        const source = fs.readFileSync(path.join(dir, entry.name, manifest.entry), "utf8");
        this.add(manifest, source, allowlist);
      } catch (err) {
        logger.warn(`[plugins] failed to load ${entry.name}: ${err.message}`);
      }
    }
    return this;
  }

  get size() {
    return this.plugins.filter((p) => !p.disabled).length;
  }

  /**
   * Decode `event` ({ contract_id, function, ledger, tx_hash, topics, data })
   * with the first matching plugin that returns valid output.
   * @returns {Promise<{ plugin: string, description: string, function?: string } | null>}
   */
  async decode(event, rawEvent = event) {
    for (const plugin of this.plugins) {
      if (plugin.disabled || !matches(plugin, event)) continue;
      try {
        const output = await plugin.sandbox.call(event);
        if (output === null) continue;
        const checked = validatePluginOutput(output);
        if (!checked.valid) throw new PluginViolation("malformed", checked.reason);
        return { plugin: plugin.id, ...checked.value };
      } catch (err) {
        const violation = err instanceof PluginViolation ? err : new PluginViolation("error", err.message);
        plugin.violations++;
        this.onViolation(plugin.id, violation, rawEvent);
        if (plugin.violations >= this.violationLimit) {
          plugin.disabled = true;
          await plugin.sandbox.close();
          logger.error(`[plugins] ${plugin.id} disabled after ${plugin.violations} violations`);
        }
      }
    }
    return null;
  }

  async close() {
    await Promise.all(this.plugins.map((p) => p.sandbox.close()));
  }
}
