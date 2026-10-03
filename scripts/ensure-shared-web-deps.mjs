import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "../vendor/web");
const requiredPackages = [
  "react-router-dom",
  "react-markdown",
  "remark-gfm",
  "codemirror",
  "@codemirror/autocomplete",
  "@codemirror/lang-markdown",
  "@codemirror/view",
  "maplibre-gl",
];

const dependenciesReady = requiredPackages.every((packageName) =>
  existsSync(path.join(webRoot, "node_modules", ...packageName.split("/"), "package.json")),
);

if (!dependenciesReady) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath is unavailable; run this bootstrap through an npm lifecycle script.");
  }

  execFileSync(
    process.execPath,
    [npmCli, "install", "--prefix", webRoot, "--no-audit", "--no-fund", "--package-lock=false"],
    { stdio: "inherit" },
  );
}
