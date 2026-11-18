const path = require("node:path");
const { createRequire } = require("node:module");
module.exports = function (source) {
  const req = createRequire(path.join(this.rootContext, "package.json"));
  return req("next/dist/compiled/babel/core").transformSync(source, {
    filename: this.resourcePath, babelrc: false, configFile: false,
    envName: "test", presets: [req.resolve("next/babel")]
  }).code;
};
