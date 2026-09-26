/** Node-only contract checks inspect component exports without rendering CSS.
 * Next compiles the real CSS modules for all browser and visual checks. */
import { createRequire } from "node:module";

const requireForStyles = createRequire(import.meta.url);
requireForStyles.extensions[".css"] = (module) => { module.exports = {}; };
