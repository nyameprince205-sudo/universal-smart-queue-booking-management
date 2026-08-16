// strip-comments.js
//
// Removes comments from every .js/.jsx file in the folders you list below,
// using a real parser (not text search-and-replace) so it can't corrupt a
// URL, a regex, or anything else that merely LOOKS like a comment.
//
// IMPORTANT — read before running:
//   1. Commit or stash any uncommitted work first. This overwrites files
//      in place; you want a clean git state so you can review the diff
//      (and revert if anything looks wrong) before pushing.
//   2. Run it, then look at `git diff` yourself before committing.
//   3. A few harmless leftovers are possible — an empty {} where a
//      comment used to sit on its own line outside any JSX markup. These
//      don't affect how the code runs; delete them by hand if you want
//      them gone, or just leave them.
//   4. This does NOT touch your git history — it only changes the
//      current files. Older commits on GitHub will still show the
//      comments; only your new commit (after running this) won't.
//
// Setup (run once):
//   npm install --save-dev @babel/parser @babel/traverse @babel/generator
//
// Usage:
//   node strip-comments.js

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;

// Edit this list to match your two project folders.
const TARGET_DIRS = [
  "src", // run once from inside queue-saas-app (backend)
  // "../frontend-new/src", // or point at the frontend separately — see note at the bottom
];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");

  let ast;
  try {
    ast = parser.parse(source, { sourceType: "module", plugins: ["jsx"] });
  } catch (err) {
    console.warn(`SKIPPED (couldn't parse): ${filePath} — ${err.message}`);
    return false;
  }

  // Clean up the one common leftover — an empty {} in JSX markup where a
  // {/* comment */} used to be.
  traverse(ast, {
    JSXExpressionContainer(nodePath) {
      if (nodePath.node.expression.type === "JSXEmptyExpression") {
        nodePath.remove();
      }
    },
  });

  const output = generate(ast, { comments: false }, source);
  fs.writeFileSync(filePath, output.code, "utf8");
  return true;
}

let processed = 0;
for (const dir of TARGET_DIRS) {
  if (!fs.existsSync(dir)) {
    console.warn(`Directory not found, skipping: ${dir}`);
    continue;
  }
  const files = walk(dir);
  for (const file of files) {
    if (stripFile(file)) processed++;
  }
}

console.log(`\nDone — ${processed} file(s) updated. Now run "git diff" to review before committing.`);
