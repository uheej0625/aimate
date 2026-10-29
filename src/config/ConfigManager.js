import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { parse } from "yaml";
import { createLogger } from "../core/logger.js";

const logger = createLogger("ConfigManager");

/**
 * Configuration file manager with hot-reload support
 * Reads YAML configuration; environment overrides stay in memory.
 */
class ConfigManager {
  constructor(configPath = "./config.yaml", { watch = true, onLoad } = {}) {
    this.configPath = path.resolve(configPath);
    this.config = null;
    this.watcher = null;
    this.changeCallbacks = [];
    this.watch = watch;
    this.onLoad = onLoad;

    this.load();
    if (this.watch) {
      this.setupWatcher();
    }
  }

  /**
   * Load config from file
   * @returns {Object|null} Loaded configuration
   */
  load() {
    try {
      const data = fs.readFileSync(this.configPath, "utf8");
      const config = parse(data, { prettyErrors: false });
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("Configuration must be a YAML mapping.");
      }
      if (
        Object.hasOwn(config, "secrets") ||
        Object.values(config.ai ?? {}).some(
          (settings) => settings && Object.hasOwn(settings, "apiKey"),
        )
      ) {
        throw new Error(
          "Credentials belong in the environment, not in YAML secrets or ai.<purpose>.apiKey.",
        );
      }
      this.config = config;
      this.onLoad?.(this);
      return this.config;
    } catch (error) {
      logger.error(
        {
          event: "config.load.failed",
          configPath: this.configPath,
          err: error,
        },
        "Configuration load failed",
      );
      this.config = {};
      return null;
    }
  }

  /**
   * Get value by dot notation path
   * @param {string} key - Dot notation path (e.g., 'ai.chat.model')
   * @returns {*} Value at the path
   */
  get(key) {
    if (!key) return this.config;
    return key.split(".").reduce((obj, k) => obj?.[k], this.config);
  }

  /**
   * Set value in memory only (does not save to file)
   * @param {string} key - Dot notation path (e.g., 'ai.chat.model')
   * @param {*} value - Value to set
   * @returns {boolean} Success status
   */
  setInMemory(key, value) {
    try {
      const keys = key.split(".");
      const lastKey = keys.pop();
      const target = keys.reduce((obj, k) => {
        if (!(k in obj)) obj[k] = {};
        return obj[k];
      }, this.config);

      target[lastKey] = value;
      return true;
    } catch (error) {
      logger.error(
        { event: "config.set.failed", key, err: error },
        "In-memory configuration update failed",
      );
      return false;
    }
  }

  /**
   * Check if key exists
   * @param {string} key - Dot notation path
   * @returns {boolean} Whether the key exists
   */
  has(key) {
    const value = this.get(key);
    return value !== undefined;
  }

  /**
   * Setup file watcher for hot-reload
   */
  setupWatcher() {
    let debounceTimer = null;

    this.watcher = chokidar.watch(this.configPath, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on("change", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const oldConfig = { ...this.config };
        const newConfig = this.load();

        if (newConfig) {
          this.notifyChange(oldConfig, newConfig);
          logger.info(
            { event: "config.reloaded", configPath: this.configPath },
            "Configuration reloaded",
          );
        }
      }, 100);
    });

    this.watcher.on("error", (error) => {
      logger.error(
        { event: "config.watcher.failed", err: error },
        "Configuration watcher failed",
      );
    });
  }

  /**
   * Register callback for config changes
   * @param {Function} callback - Function to call when config changes
   */
  onChange(callback) {
    if (typeof callback === "function") {
      this.changeCallbacks.push(callback);
    }
  }

  /**
   * Notify all registered callbacks
   * @param {Object} oldConfig - Previous configuration
   * @param {Object} newConfig - New configuration
   */
  notifyChange(oldConfig, newConfig) {
    this.changeCallbacks.forEach((callback) => {
      try {
        callback(newConfig, oldConfig);
      } catch (error) {
        logger.error(
          { event: "config.callback.failed", err: error },
          "Configuration change callback failed",
        );
      }
    });
  }

  /**
   * Stop watching config file
   */
  close() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Get entire config object (use carefully)
   * @returns {Object} Configuration object
   */
  getAll() {
    return { ...this.config };
  }
}

export default ConfigManager;
