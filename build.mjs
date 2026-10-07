import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "public");
const files = await readdir(root);
const campaignFile = files.find((file) => file.toLowerCase().includes("help single mom") && file.toLowerCase().endsWith(".html"));

if (!campaignFile) throw new Error("The source campaign HTML file was not found.");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const [campaignHtml, supabaseClient, campaignData, campaignRuntime, interactions] = await Promise.all([
  readFile(path.join(root, campaignFile), "utf8"),
  readFile(path.join(root, "supabase-client.js"), "utf8"),
  readFile(path.join(root, "campaign-data.js"), "utf8"),
  readFile(path.join(root, "campaign-runtime.js"), "utf8"),
  readFile(path.join(root, "interactions.js"), "utf8")
]);

const supabaseUrl = process.env.SUPABASE_URL || "https://ojwshgpvijmbcjyiggxl.supabase.co";
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_jESyYbVDaDejhlzkjJ4kfw_iQVvYHY7";
const runtimeConfig = `window.CloudySupabaseConfig=Object.freeze(${JSON.stringify({ url: supabaseUrl, publishableKey: supabasePublishableKey, proxyPath: "/supabase" })});`;
const injection = `<script>${runtimeConfig}</script><script>${supabaseClient}</script><script>${campaignData}</script><script>${campaignRuntime}</script><script>${interactions}</script>`;
const campaignHtmlWithNetworkPolicy = campaignHtml
  .replace("default-src 'none';", `default-src 'none'; connect-src 'self' ${supabaseUrl};`)
  .replace("img-src 'self' data:;", `img-src 'self' data: ${supabaseUrl};`);
const indexHtml = campaignHtmlWithNetworkPolicy.includes("</body>")
  ? campaignHtmlWithNetworkPolicy.replace("</body>", `${injection}</body>`)
  : `${campaignHtmlWithNetworkPolicy}${injection}`;

await writeFile(path.join(output, "index.html"), indexHtml, "utf8");

const publicFiles = [
  "admin.html",
  "admin-campaign.html",
  "admin-donations.html",
  "admin-content.html",
  "admin-gateway.html",
  "admin-apis.html",
  "admin-tracking.html",
  "admin-login.html",
  "admin.css",
  "admin-overview.css",
  "admin.js",
  "admin-overview.js",
  "admin-auth.js",
  "campaign-data.js",
  "supabase-client.js",
  "checkout.html",
  "checkout.css",
  "checkout.js",
  "payment-status.html"
];

await Promise.all(publicFiles.map((file) => cp(path.join(root, file), path.join(output, file))));
await mkdir(path.join(output, "vendor"), { recursive: true });
await Promise.all([
  cp(path.join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl.mjs"), path.join(output, "vendor", "maplibre-gl.mjs")),
  cp(path.join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"), path.join(output, "vendor", "maplibre-gl-worker.mjs")),
  cp(path.join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl.css"), path.join(output, "vendor", "maplibre-gl.css"))
]);
await writeFile(path.join(output, "supabase-config.js"), runtimeConfig, "utf8");
await cp(path.join(root, "assets"), path.join(output, "assets"), { recursive: true });
await writeFile(path.join(output, "robots.txt"), "User-agent: *\nDisallow: /admin\nDisallow: /admin-login\n", "utf8");

console.log(`Static deployment generated in ${output}`);
