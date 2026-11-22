import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(repo, ".next", "shopper-connected-preview");
const args = process.argv.slice(2);
let port = 8790, buildOnly = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--build-only") buildOnly = true;
  else if (args[i] === "--port" && /^\d+$/.test(args[i + 1] || "")) port = Number(args[++i]);
  else throw new Error("Use --build-only or --port 8789.");
}
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid loopback port.");
const require = createRequire(path.join(repo, "package.json"));
const compiler = require("next/dist/compiled/webpack/webpack"); compiler.init();
const { webpack, NormalModule } = compiler;
const trace = { traceChild() { return this; }, traceFn(fn) { return fn(); }, traceAsyncFn(fn) { return fn(); } };
const plugins = [{ apply(compiler) { compiler.hooks.compilation.tap("PreviewTrace", compilation => {
  NormalModule.getCompilationHooks(compilation).loader.tap("PreviewTrace", loader => { loader.currentTraceSpan = trace; });
}); } }];
await fs.mkdir(output, { recursive: true });
await new Promise((resolve, reject) => {
  const build = webpack({ mode: "development", devtool: false, context: repo,
    entry: path.join(repo, "tests/fixtures/shopper-connected-preview.jsx"),
    output: { path: output, filename: "preview.js", publicPath: "/" }, cache: false, plugins,
    resolve: { extensions: [".js", ".jsx", ".mjs", ".json"], modules: [path.join(repo, "node_modules"), "node_modules"],
      alias: { "@": repo, "@babel/runtime": path.join(repo, "node_modules/next/dist/compiled/@babel/runtime") } },
    module: { rules: [
      { test: /\.[cm]?jsx?$/, type: "javascript/auto", exclude: /node_modules/, use: [{ loader: path.join(repo, "scripts/preview-shopper-mobile-babel.cjs") }] },
      { test: /\.module\.css$/, use: [{ loader: require.resolve("next/dist/build/webpack/loaders/next-style-loader") },
        { loader: require.resolve("next/dist/build/webpack/loaders/css-loader/src"), options: { esModule: true,
          modules: { mode: "local", localIdentName: "[name]__[local]__[hash:base64:5]", getLocalIdent: require("next/dist/build/webpack/config/blocks/css/loaders/getCssModuleLocalIdent").getCssModuleLocalIdent },
          postcss: async () => ({ postcss: require("postcss") }), import: false, url: false } }] }
    ] }, performance: { hints: false }
  }, (error, stats) => { build.close(() => {}); if (error) return reject(error); if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true }))); resolve(); });
});
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Ruvanas Rewards - connected local test</title><style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:#f7f6f2;color:#152339}button,input,select{font:inherit}button,a,input,summary{-webkit-tap-highlight-color:transparent}.preview-safety{background:#13273c;color:#fff;padding:8px 16px;font-size:11px;text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap}.preview-safety strong{color:#ffdc81}.preview-controls{padding:18px 22px 90px;max-width:1140px;margin:auto;font-size:12px;line-height:1.5;color:#45536a}.preview-controls summary{cursor:pointer;font-weight:700}.preview-controls button{padding:10px 14px;margin:5px 8px 5px 0;border:1px solid #bbc4cf;background:#fff;color:#172b43;border-radius:9px;min-height:44px}.preview-controls button:focus-visible{outline:3px solid #b88718;outline-offset:3px}
</style></head><body><div id="root"></div><script src="/preview.js"></script></body></html>`;
await fs.writeFile(path.join(output, "index.html"), html);
console.log(JSON.stringify({ built: true, component: "ConnectedShopperDashboard", syntheticData: true, ownedDatabaseHarnessRequired: true, liveNetwork: false }));
