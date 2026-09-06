import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "dist");
const files = await readdir(root);
const campaignFile = files.find((file) => file.toLowerCase().includes("help single mom") && file.toLowerCase().endsWith(".html"));

if (!campaignFile) throw new Error("The source campaign HTML file was not found.");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const [campaignHtml, campaignData, campaignRuntime, interactions] = await Promise.all([
  readFile(path.join(root, campaignFile), "utf8"),
  readFile(path.join(root, "campaign-data.js"), "utf8"),
  readFile(path.join(root, "campaign-runtime.js"), "utf8"),
  readFile(path.join(root, "interactions.js"), "utf8")
]);

const injection = `<script>${campaignData}</script><script>${campaignRuntime}</script><script>${interactions}</script>`;
const indexHtml = campaignHtml.includes("</body>")
  ? campaignHtml.replace("</body>", `${injection}</body>`)
  : `${campaignHtml}${injection}`;

await writeFile(path.join(output, "index.html"), indexHtml, "utf8");

const publicFiles = [
  "admin.html",
  "admin-login.html",
  "admin.css",
  "admin.js",
  "admin-auth.js",
  "campaign-data.js",
  "checkout.html",
  "checkout.css",
  "checkout.js"
];

await Promise.all(publicFiles.map((file) => cp(path.join(root, file), path.join(output, file))));
await cp(path.join(root, "assets"), path.join(output, "assets"), { recursive: true });
await writeFile(path.join(output, "robots.txt"), "User-agent: *\nDisallow: /admin\nDisallow: /admin-login\n", "utf8");

console.log(`Static deployment generated in ${output}`);
