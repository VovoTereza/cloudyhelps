import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "public");
const requiredFiles = [
  "index.html",
  "checkout.html",
  "checkout.css",
  "checkout.js",
  "journey-presence.js",
  "payment-status.html",
  "admin-login.html",
  "admin.html",
  "admin-overview.css",
  "admin-overview.js",
  "vendor/maplibre-gl.mjs",
  "vendor/maplibre-gl-worker.mjs",
  "vendor/maplibre-gl.css",
  "vendor/supabase.js",
  "admin-campaign.html",
  "admin-donations.html",
  "admin-content.html",
  "admin-gateway.html",
  "admin-apis.html",
  "admin-tracking.html",
  "admin.css",
  "admin-auth.js",
  "admin.js",
  "campaign-data.js",
  "supabase-client.js",
  "supabase-config.js",
  "robots.txt"
];

const missing = [];
for (const file of requiredFiles) {
  try {
    const fileStats = await stat(path.join(output, file));
    if (!fileStats.isFile() || fileStats.size === 0) missing.push(file);
  } catch {
    missing.push(file);
  }
}

if (missing.length) {
  throw new Error(`Production build is missing required files: ${missing.join(", ")}`);
}

const htmlFiles = ["index.html", "checkout.html", "payment-status.html", "admin-login.html", "admin.html", "admin-campaign.html", "admin-donations.html", "admin-content.html", "admin-gateway.html", "admin-apis.html", "admin-tracking.html"];
const brokenReferences = [];
const unsafeReferences = [];
const attributePattern = /(?:src|href)=["']([^"']+)["']/gi;

for (const htmlFile of htmlFiles) {
  const htmlPath = path.join(output, htmlFile);
  const html = await readFile(htmlPath, "utf8");

  if (/\b(?:file:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1))\b/i.test(html)) {
    unsafeReferences.push(htmlFile);
  }

  for (const match of html.matchAll(attributePattern)) {
    const reference = match[1].trim();
    if (
      !reference ||
      reference.startsWith("#") ||
      reference.startsWith("//") ||
      /^[a-z][a-z\d+.-]*:/i.test(reference)
    ) continue;

    const pathname = reference.split(/[?#]/, 1)[0];
    if (!path.extname(pathname)) continue;

    const decodedPath = decodeURIComponent(pathname);
    const target = decodedPath.startsWith("/")
      ? path.join(output, decodedPath.slice(1))
      : path.resolve(path.dirname(htmlPath), decodedPath);

    if (!target.startsWith(output)) {
      brokenReferences.push(`${htmlFile}: ${reference}`);
      continue;
    }

    try {
      await access(target);
    } catch {
      brokenReferences.push(`${htmlFile}: ${reference}`);
    }
  }
}

if (unsafeReferences.length) {
  throw new Error(`Production HTML contains local-only URLs: ${unsafeReferences.join(", ")}`);
}

if (brokenReferences.length) {
  throw new Error(`Production HTML contains missing local assets:\n${brokenReferences.join("\n")}`);
}

const indexHtml = await readFile(path.join(output, "index.html"), "utf8");
for (const runtimeMarker of ["CloudyCampaignStore", "tier-list", "button[aria-pressed]"]) {
  if (!indexHtml.includes(runtimeMarker)) {
    throw new Error(`Campaign runtime marker was not embedded: ${runtimeMarker}`);
  }
}

console.log("Production build validation passed.");
