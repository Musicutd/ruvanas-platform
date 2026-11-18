import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transformSync } = require("next/dist/build/swc");
const filename = "app/admin/organisations/new-client-admin/CreateClientAdminForm.js";
const compiled = transformSync(readFileSync(new URL(`../${filename}`, import.meta.url), "utf8"), {
  filename, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" }
}).code;
const module = { exports: {} };
const forbidden = () => { throw new Error("UNEXPECTED_UI_SIDE_EFFECT"); };
vm.runInNewContext(compiled, {
  module, exports: module.exports, fetch: forbidden, process: { env: { NODE_ENV: "test" } },
  window: new Proxy({}, { get: forbidden }),
  require(name) {
    if (["react", "react/jsx-runtime", "react/jsx-dev-runtime"].includes(name)) return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "./client-admin.module.css") return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw new Error(`UNEXPECTED_UI_DEPENDENCY:${name}`);
  }
}, { filename });

const Form = module.exports.default;
const plans = [{ id: "synthetic-retail-plan", name: "Synthetic Retail plan" }];
const endpoint = "/api/admin/organisations/with-client-admin";
const render = (availablePlans = plans) => renderToStaticMarkup(React.createElement(Form, { plans: availablePlans }));
// Inspect attributes from React's actual rendered HTML, never source patterns.
function elements(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "gi"))].map(match => ({
    index: match.index,
    attributes: Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name.toLowerCase(), value]))
  }));
}

test("rendered native form uses POST to the exact API endpoint, with no GET or destination overrides", () => {
  const html = render(), forms = elements(html, "form");
  assert.equal(forms.length, 1);
  const attrs = forms[0].attributes;
  assert.equal((attrs.method || "get").toUpperCase(), "POST");
  assert.equal(attrs.action, endpoint);
  const destination = new URL(attrs.action, "https://synthetic.example.invalid/admin/organisations/new-client-admin");
  assert.equal(destination.origin, "https://synthetic.example.invalid");
  assert.equal(destination.search, ""); assert.equal(destination.hash, "");
  for (const { attributes } of [...elements(html, "input"), ...elements(html, "button")]) {
    assert.equal(Object.hasOwn(attributes, "formmethod"), false);
    assert.equal(Object.hasOwn(attributes, "formaction"), false);
  }
  assert.match(html, /<noscript>Enable JavaScript/);
});

test("rendered password controls are masked and required with no initial credential values", () => {
  const html = render(), controls = elements(html, "input").map(row => row.attributes);
  const passwords = controls.filter(row => ["password", "confirmPassword"].includes(row.name));
  assert.equal(passwords.length, 2);
  for (const attrs of passwords) {
    assert.equal(attrs.type, "password"); assert.equal(attrs.autocomplete, "new-password");
    assert.equal(attrs.minlength, "15"); assert.equal(attrs.maxlength, "72");
    assert.equal(Object.hasOwn(attrs, "required"), true);
    assert.equal(Object.hasOwn(attrs, "value"), false); assert.equal(Object.hasOwn(attrs, "defaultvalue"), false);
  }
  assert.equal(controls.some(row => row.type === "hidden"), false);
});

test("rendered confirmation is explicit and unchecked, with no preselected Retail plan", () => {
  const html = render(), confirmation = elements(html, "input").map(row => row.attributes).find(row => row.name === "confirmCreate");
  assert.equal(confirmation.type, "checkbox"); assert.equal(Object.hasOwn(confirmation, "required"), true);
  assert.equal(Object.hasOwn(confirmation, "checked"), false);
  const select = elements(html, "select"); assert.equal(select.length, 1); assert.equal(select[0].attributes.name, "planId");
  assert.equal(Object.hasOwn(select[0].attributes, "required"), true);
  const selected = elements(html, "option").map(row => row.attributes).filter(row => Object.hasOwn(row, "selected"));
  assert.equal(selected.length, 1); assert.equal(selected[0].value, ""); assert.equal(Object.hasOwn(selected[0], "disabled"), true);
  assert.equal(Object.hasOwn(elements(html, "fieldset")[0].attributes, "disabled"), false);
});

test("rendered form without available plans disables every editable and submit control through its fieldset", () => {
  const html = render([]), fieldsets = elements(html, "fieldset");
  assert.equal(fieldsets.length, 1); assert.equal(Object.hasOwn(fieldsets[0].attributes, "disabled"), true);
  const end = html.indexOf("</fieldset>", fieldsets[0].index);
  for (const control of [...elements(html, "input"), ...elements(html, "select"), ...elements(html, "button")]) {
    assert.ok(control.index > fieldsets[0].index && control.index < end);
  }
  assert.match(html, /role="alert">No active Retail trial plan is available/);
  assert.equal(elements(html, "option").length, 1);
  assert.equal(elements(html, "form")[0].attributes.method, "post");
});
