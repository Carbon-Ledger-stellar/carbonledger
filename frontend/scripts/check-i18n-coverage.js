#!/usr/bin/env node
/**
 * CI guard for issue #620: fails the build if a buyer/retirement-facing
 * component contains hardcoded English prose instead of a next-intl
 * translation call.
 *
 * Heuristic, not a parser: strips known-safe constructs (t()/t.rich() calls,
 * comments, className/style/href/id-like attributes) and then flags any
 * remaining JSX text node or user-facing string attribute (placeholder,
 * aria-label, aria-describedby text, title, alt) containing two or more
 * consecutive English words. False positives are expected to be rare given
 * the narrow scope of files scanned — see BUYER_FLOW_PATHS below.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// Buyer-facing and retirement-facing surfaces in scope for issue #620.
const BUYER_FLOW_PATHS = [
  "app/marketplace",
  "app/buy",
  "app/retire",
  "components/MarketplaceFilter.tsx",
  "components/MarketplaceSortControls.tsx",
  "components/ComparisonTray.tsx",
  "components/BulkPurchaseCart.tsx",
  "components/WalletPrompt.tsx",
  "components/CreditCard.tsx",
  "components/RetirementCertificate.tsx",
  "components/RetireConfirmModal.tsx",
];

// Attributes whose string literal values are user-facing copy, not code.
const TEXT_ATTRS = ["placeholder", "aria-label", "title", "alt"];

// Words that read as "English prose" but are actually units/brand/proper nouns
// used interchangeably across locales — not worth externalizing.
const ALLOWLIST = /^(carbonledger|usdc|xlm|co2e?|tco2e?|freighter|stellar|esg|api|url|id|pdf|csv|json)$/i;

function listFiles(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];
  const out = [];
  for (const entry of fs.readdirSync(abs)) {
    if (entry.includes("__tests__") || entry.includes(".test.")) continue;
    const full = path.join(abs, entry);
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(path.relative(ROOT, full)));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function stripSafeConstructs(source) {
  return source
    // t("key"), t('key', {...}), t.rich(...) calls — whatever they render is translated.
    .replace(/\bt(?:\.\w+)?\([^)]*\)/g, "")
    // JS/JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    // Interpolated expressions inside JSX text, e.g. {count}
    .replace(/\{[^{}]*\}/g, "{}");
}

function findHardcodedProse(source, file) {
  const findings = [];
  const cleaned = stripSafeConstructs(source);

  // JSX text nodes: content directly between > and < with no braces left.
  const textNodeRe = />([^<>{}]+)</g;
  let m;
  while ((m = textNodeRe.exec(cleaned))) {
    checkCandidate(m[1], findings, file, "JSX text");
  }

  // User-facing string-literal attributes, e.g. placeholder="Search by ...".
  for (const attr of TEXT_ATTRS) {
    const attrRe = new RegExp(`\\b${attr}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`, "g");
    while ((m = attrRe.exec(cleaned))) {
      checkCandidate(m[1], findings, file, attr);
    }
  }

  return findings;
}

function checkCandidate(text, findings, file, kind) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  // Real JSX text/copy never contains these — their presence means the ">…<"
  // regex actually spanned a type annotation or expression (e.g. useState<Foo | null>(...)).
  if (/[=;(){}<>]/.test(trimmed)) return;
  const words = trimmed.split(" ").filter((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w));
  const meaningfulWords = words.filter((w) => !ALLOWLIST.test(w));
  if (meaningfulWords.length >= 2) {
    findings.push({ file: path.relative(ROOT, file), kind, text: trimmed });
  }
}

function main() {
  const files = BUYER_FLOW_PATHS.flatMap(listFiles);
  const allFindings = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    allFindings.push(...findHardcodedProse(source, file));
  }

  if (allFindings.length > 0) {
    console.error(`\n✗ Found ${allFindings.length} hardcoded English string(s) in buyer-flow components:\n`);
    for (const f of allFindings) {
      console.error(`  ${f.file} [${f.kind}]: "${f.text}"`);
    }
    console.error("\nExternalize these into public/locales/*/common.json and reference them via next-intl's useTranslations().\n");
    process.exit(1);
  }

  console.log(`✓ No hardcoded English strings found across ${files.length} buyer-flow file(s).`);
}

main();
