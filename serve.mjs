import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
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

// Forward /api/* requests to the Express API server on port 3001.
// Strips the /api prefix so /api/login -> localhost:3001/login, etc.
function proxyToApi(req, res, urlPath) {
  const target = urlPath; // forward full path — server.js rewrites /api/* internally
  const search = new URL(req.url, "http://localhost").search || "";
  const chunks = [];

  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: "localhost:3001" };
    if (body.length) headers["content-length"] = body.length;

    const proxyReq = httpRequest(
      { hostname: "localhost", port: 3001, path: target + search, method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "API server unreachable. Run server.js on port 3001 (use start-servers.bat)." }));
    });

    if (body.length) proxyReq.write(body);
    proxyReq.end();
  });
}

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

    if (urlPath.startsWith("/api/")) {
      proxyToApi(req, res, urlPath);
      return;
    }

    let filePath = urlPath === "/" ? "/index.html" : urlPath;
    filePath = normalize(join(root, filePath));
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
