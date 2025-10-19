import esbuild from "esbuild";
import process from "node:process";

const isWatch = process.argv.includes("--watch");

const options = {
  entryPoints: ["main.ts"],
  bundle: true,
  outfile: "main.js",
  external: ["obsidian"],
  format: "cjs",
  platform: "node",
  sourcemap: isWatch
};

try {
  if (isWatch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("[esbuild] watching for changes…");
  } else {
    await esbuild.build(options);
    console.log("[esbuild] build complete");
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}