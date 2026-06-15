import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = 3000;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript",
  ".mjs":  "text/javascript",
  ".css":  "text/css",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4":  "video/mp4",
  ".svg":  "image/svg+xml",
  ".json": "application/json",
  ".woff2":"font/woff2",
};

createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (urlPath === "/") urlPath = "/index.html";
    const filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}`));
