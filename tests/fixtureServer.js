const http = require("http");
const fs = require("fs");
const path = require("path");

const fixturesDir = path.join(__dirname, "fixtures");
const PORT = 8765;

let server = null;

function startFixtureServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const url = req.url === "/" ? "/single-video.html" : req.url;
      const file = path.join(fixturesDir, path.basename(url));
      if (!file.startsWith(fixturesDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const ext = path.extname(file);
        const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
        res.setHeader("Content-Type", types[ext] || "application/octet-stream");
        res.end(data);
      });
    });
    server.listen(PORT, "127.0.0.1", () => resolve(`http://127.0.0.1:${PORT}`));
  });
}

function stopFixtureServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = { startFixtureServer, stopFixtureServer, getFixtureBaseUrl: () => `http://127.0.0.1:${PORT}` };
