import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration file manager with hot-reload support
 * Provides CRUD operations for JSON config files
 */
class ConfigManager {
  constructor(configPath = "./config.json") {
    this.configPath = path.resolve(configPath);
    this.config = null;
    this.watcher = null;
    this.changeCallbacks = [];

    this.load();
    this.setupWatcher();
  }

  /**
   * Load config from file
   * @returns {Object|null} Loaded configuration
   */
  load() {
    try {
      const data = fs.readFileSync(this.configPath, "utf8");
      this.config = JSON.parse(data);
      return this.config;
    } catch (error) {
      console.error(
        `Failed to load config from ${this.configPath}:`,
        error.message,
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
      console.error(
        `Failed to save config to ${this.configPath}:`,
        error.message,
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
      console.error(`Failed to set ${key}:`, error.message);
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
      console.error(`Failed to set ${key}:`, error.message);
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
      console.error(`Failed to delete ${key}:`, error.message);
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
    const isTest = process.env.NODE_ENV === "test" || process.argv.some(arg => arg.includes("--test")) || process.execArgv.some(arg => arg.includes("--test")) || !!process.env.NODE_TEST_CONTEXT;
    if (isTest) return;

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
          console.log("✓ Configuration reloaded from file");
          this.notifyChange(oldConfig, newConfig);
        }
      }, 100);
    });

    this.watcher.on("error", (error) => {
      console.error("Config watcher error:", error.message);
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
        console.error("Config change callback error:", error.message);
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
