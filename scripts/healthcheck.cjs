/**
 * Docker HEALTHCHECK for the API container — GET /health on PORT (default 4000).
 */
const http = require("http");
const port = Number(process.env.PORT ?? 4000);
const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});
req.on("error", () => process.exit(1));
req.setTimeout(2500, () => {
  req.destroy();
  process.exit(1);
});
