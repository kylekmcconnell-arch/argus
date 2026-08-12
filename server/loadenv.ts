// Side-effect module: load .env before any other server module reads env.
// Imported first in index.ts so ESM evaluates it ahead of config/adapters.
import process from "node:process";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file — fixture fallback mode
}
