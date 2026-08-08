// Append a dated entry to progress.md (newest-first) about the argon2 + settings fixes.
import { readFileSync, writeFileSync } from "fs";

const ENTRY = `- **Argon2 password hashing + settings responsiveness (2026-08-08)**: Replaced the weak SHA-256 password hashing with Argon2id via @node-rs/argon2 (OWASP params: 19 MiB, 2 iterations). Existing accounts still log in via a legacy-SHA-256 compatibility path and are upgraded in place on next successful login (\`migrateLegacyPasswordHash\` in \`src/lib/auth.ts\`). Fresh signups store PHC-format \`$argon2id$...\` hashes. The native .node binary is kept out of webpack via \`serverExternalPackages\` plus a webpack-externals fallback in \`next.config.js\` (dev-mode RSC layer edge case). Seed scripts (\`seed-large-graph.mjs\`, \`seed-supabase.mjs\`, \`seed-supabase.cjs\`) now generate argon2 hashes too. Also fixed the settings page: the CONCISE/STANDARD/DETAILED verbosity row (and the identical appearance/density rows) overflowed on phones — 3 nowrap buttons in a non-wrapping flex container — now wrap cleanly with min-widths; verified zero horizontal overflow at 320/375/768px (\`scripts/verify-argon2.mjs\` + \`scripts/responsive-audit.mjs\`).\n`;

const md = readFileSync("progress.md", "utf8");
if (md.includes("Argon2 password hashing")) {
  console.log("entry already present, skipping");
  process.exit(0);
}

// Insert after the "## Progress Log" style header if present, else prepend to the bullet list.
const lines = md.split("\n");
let idx = lines.findIndex((l) => /^## .*Log/i.test(l) || /^## Changelog/i.test(l));
if (idx === -1) {
  // Find the first bullet line and insert before it.
  idx = lines.findIndex((l) => /^\s*-\s/.test(l));
  if (idx === -1) {
    lines.unshift(ENTRY.trimEnd());
    writeFileSync("progress.md", lines.join("\n") + "\n");
    console.log("prepended entry (no header found)");
    process.exit(0);
  }
  lines.splice(idx, 0, ENTRY.trimEnd());
  writeFileSync("progress.md", lines.join("\n"));
  console.log("inserted entry before first bullet");
  process.exit(0);
}
lines.splice(idx + 1, 0, ENTRY.trimEnd());
writeFileSync("progress.md", lines.join("\n"));
console.log("inserted entry after section header");
