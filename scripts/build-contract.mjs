// Reproducible contract build (near-sdk-js v2's `build` command fails to parse
// decorators in rollup on this setup, so run rollup+babel directly, then the
// SDK's transpile step). Usage: node scripts/build-contract.mjs
import { rollup } from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { babel } from "@rollup/plugin-babel";
import { execSync } from "child_process";

const bundle = await rollup({
  input: "contract/src/index.ts",
  plugins: [
    nodeResolve({ extensions: [".js", ".ts"] }),
    babel({
      babelHelpers: "bundled",
      extensions: [".ts", ".js", ".jsx", ".es6", ".es", ".mjs"],
      presets: ["@babel/preset-typescript"],
      plugins: [
        "near-sdk-js/lib/cli/build-tools/include-bytes.js",
        ["near-sdk-js/lib/cli/build-tools/near-bindgen-exporter.js", { verbose: false }],
        ["@babel/plugin-proposal-decorators", { version: "legacy" }],
      ],
    }),
  ],
});
await bundle.write({ sourcemap: true, file: "build/contract.js", format: "es" });
console.log("rollup OK -> build/contract.js");
execSync("npx near-sdk-js transpileJsAndBuildWasm build/contract.wasm", { stdio: "inherit" });
console.log("wasm OK -> build/contract.wasm");
