import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const publicFiles = ["index.html", "styles.css", "app.js", "data.js", "watchlist.js"];

await rm(output, {recursive:true,force:true});
await mkdir(output,{recursive:true});
for (const file of publicFiles) {
  await cp(resolve(root,file),resolve(output,file));
}
console.log("Static dashboard built to dist/ (" + publicFiles.length + " files).");
