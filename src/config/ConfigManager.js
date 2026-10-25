import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { createLogger } from "../core/logger.js";

const logger = createLogger("ConfigManager");

/**
 * Configuration file manager with hot-reload support
 * Provides CRUD operations for JSON config files
 */
class ConfigManager {
  constructor(configPath = "./config.json", { watch = true, onLoad } = {}) {
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
      this.config = JSON.parse(data);
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
   * Save current config to file
   * @returns {boolean} Success status
   */
  save() {
    try {
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        "utf8",
      );
      return true;
    } catch (error) {
      logger.error(
        {
          event: "config.save.failed",
          configPath: this.configPath,
          err: error,
        },
        "Configuration save failed",
      );
      return false;
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
   * Set value by dot notation path
   * @param {string} key - Dot notation path (e.g., 'ai.chat.model')
   * @param {*} value - Value to set
   * @returns {boolean} Success status
   */
  set(key, value) {
    try {
      const keys = key.split(".");
      const lastKey = keys.pop();
      const target = keys.reduce((obj, k) => {
        if (!(k in obj)) obj[k] = {};
        return obj[k];
      }, this.config);

      target[lastKey] = value;
      return this.save();
    } catch (error) {
      logger.error(
        { event: "config.set.failed", key, err: error },
        "Configuration update failed",
      );
      return false;
    }
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
   * Delete value by dot notation path
   * @param {string} key - Dot notation path (e.g., 'ai.chat.temperature')
   * @returns {boolean} Success status
   */
  delete(key) {
    try {
      const keys = key.split(".");
      const lastKey = keys.pop();
      const target = keys.reduce((obj, k) => obj?.[k], this.config);

      if (target && lastKey in target) {
        delete target[lastKey];
        return this.save();
      }
      return false;
    } catch (error) {
      logger.error(
        { event: "config.delete.failed", key, err: error },
        "Configuration delete failed",
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

  /**
   * Reset config to default or provided object
   * @param {Object} defaultConfig - Default configuration
   * @returns {boolean} Success status
   */
  reset(defaultConfig = {}) {
    this.config = defaultConfig;
    return this.save();
  }
}

export default ConfigManager;
