import fs from "node:fs";
import path from "node:path";

const file=path.resolve("node_modules/@arcium-hq/client/build/index.mjs");

if(!fs.existsSync(file)){
  console.log("[arcium-browser] @arcium-hq/client build not found; nothing to patch");
  process.exit(0);
}

let text=fs.readFileSync(file,"utf8");
const before=text;

// @arcium-hq/client currently emits a Node-oriented default import, while
// @anchor-lang/core's browser entry exposes named exports only. Namespace
// import preserves the SDK's expected anchor.* surface and lets Vite bundle it.
text=text
  .replace(
    /import\s+anchor\s+from\s+['"]@anchor-lang\/core['"];?/g,
    'import * as anchor from "@anchor-lang/core";'
  )
  .replace(
    /import\s+anchor__default\s*,\s*\{([^}]+)\}\s*from\s*['"]@anchor-lang\/core['"];?/g,
    (_match, named) =>
      'import * as anchor__default from "@anchor-lang/core";\n' +
      'import {' + named + '} from "@anchor-lang/core";'
  );

if(text!==before){
  fs.writeFileSync(file,text);
  console.log("[arcium-browser] patched @anchor-lang/core default import");
}else{
  console.log("[arcium-browser] no anchor import patch required");
}
