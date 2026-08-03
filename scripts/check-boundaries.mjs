import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const allowedDependencies = new Set(["@elqora/dgp-spec", "@elqora/dgp-core"]);
const errors = [];

for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
  if (!allowedDependencies.has(dependency)) errors.push(`Forbidden runtime dependency ${dependency}.`);
}

const forbiddenPackages = /(?:validation|form-palette|workspace|studio|react)/i;
const canonicalTypes = new Set(["ProductDefinition", "OrderSnapshot", "HandlerService"]);
const files = (await readdir(path.join(root, "src"), { recursive: true }))
  .filter((entry) => entry.endsWith(".ts"))
  .map((entry) => path.join("src", entry));

for (const relativePath of files) {
  const source = ts.createSourceFile(relativePath, await readFile(path.join(root, relativePath), "utf8"), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const name = node.moduleSpecifier.getText(source).replaceAll(/["']/g, "");
      if (!name.startsWith(".") && (!allowedDependencies.has(name) || forbiddenPackages.test(name))) {
        errors.push(`${relativePath} imports forbidden package ${name}.`);
      }
    }
    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && canonicalTypes.has(node.name.text)) {
      errors.push(`${relativePath} independently authors canonical type ${node.name.text}.`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (errors.length > 0) throw new Error(`Ordering boundary violations:\n${errors.join("\n")}`);
console.log("Ordering dependency and source boundaries are valid.");
