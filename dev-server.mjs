import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ? path.resolve(projectRoot, process.argv[2]) : projectRoot;
const host = "127.0.0.1";
const port = 8000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
    let target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(root)) throw new Error("Invalid path");
    if ((await stat(target)).isDirectory()) {
      const files = (await import("node:fs/promises")).readdir(target);
      const htmlFiles = (await files).filter((file) => file.toLowerCase().endsWith(".html"));
      const html = htmlFiles.find((file) => file.toLowerCase() === "index.html")
        ?? htmlFiles.find((file) => file.toLowerCase().includes("help single mom"))
        ?? htmlFiles[0];
      if (!html) throw new Error("No HTML file found");
      target = path.join(target, html);
    }
    const extension = path.extname(target).toLowerCase();
    response.writeHead(200, { "Content-Type": mimeTypes[extension] ?? "application/octet-stream" });
    if (extension === ".html") {
      let html = await readFile(target, "utf8");
      if (path.basename(target).toLowerCase().includes("help single mom")) {
        const supabaseConfig = await readFile(path.join(projectRoot, "supabase-config.js"), "utf8");
        const supabaseClient = await readFile(path.join(projectRoot, "supabase-client.js"), "utf8");
        const campaignData = await readFile(path.join(projectRoot, "campaign-data.js"), "utf8");
        const campaignRuntime = await readFile(path.join(projectRoot, "campaign-runtime.js"), "utf8");
        const interactions = await readFile(path.join(projectRoot, "interactions.js"), "utf8");
        html = html
          .replace("default-src 'none';", "default-src 'none'; connect-src 'self' https://ojwshgpvijmbcjyiggxl.supabase.co;")
          .replace("img-src 'self' data:;", "img-src 'self' data: https://ojwshgpvijmbcjyiggxl.supabase.co;");
        html = `${html}\n<script>${supabaseConfig}</script><script>${supabaseClient}</script><script>${campaignData}</script><script>${campaignRuntime}</script><script>${interactions}</script>`;
      }
      response.end(html);
    } else {
      response.end(await readFile(target));
    }
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => console.log(`Serving ${root} at http://${host}:${port}/`));
