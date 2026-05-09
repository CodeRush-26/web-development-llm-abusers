/**
 * Load repo-root `.env` before other server modules read process.env.
 * Must be imported first from `index.ts`.
 */
import path from "node:path";
import dotenv from "dotenv";

const rootEnv = path.resolve(__dirname, "../../../.env");
const rootLocal = path.resolve(__dirname, "../../../.env.local");

dotenv.config({ path: rootEnv });
dotenv.config({ path: rootLocal, override: true });
