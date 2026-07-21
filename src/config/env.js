import dotenv from "dotenv";

/**
 * Load environment variables from .env.
 *
 * Shell/CI-provided environment variables intentionally keep priority over
 * local .env values unless override is explicitly requested.
 *
 * @param {import("dotenv").DotenvConfigOptions} [options]
 * @returns {import("dotenv").DotenvConfigOutput}
 */
export function loadEnv(options = {}) {
  return dotenv.config({
    quiet: true,
    override: false,
    ...options,
  });
}
