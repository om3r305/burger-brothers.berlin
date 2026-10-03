// Temporary mitigation for GHSA-vfj7-8cjw-p6xm; keep upstream version/audit visible.
// Remove when upstream ships depth guards. No Tailwind major migration is needed.
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(require.resolve('braces/package.json'));
const pkg = require(path.join(root, 'package.json'));
if (pkg.version !== '3.0.3') throw Error('Review braces mitigation for upstream version ' + pkg.version);
const marker = '// BB_GHSA_vfj7_DEPTH_GUARD';
function patch(file, anchor, insert, all = false) {
  const target = path.join(root, file);
  let source = fs.readFileSync(target, 'utf8');
  if (source.includes(marker)) return;
  if (!source.includes(anchor)) throw Error('braces patch anchor missing: ' + file);
  source = all ? source.split(anchor).join(insert) : source.replace(anchor, insert);
  fs.writeFileSync(target, source);
}
patch('lib/parse.js', 'stack.push(block);', `${marker}\n      if (stack.length >= 128) throw new SyntaxError('Brace nesting exceeds safe depth');\n      stack.push(block);`, true);
const guard = `\n  ${marker}\n  require('./bb-depth-guard')(ast);`;
patch('lib/compile.js', 'const compile = (ast, options = {}) => {', 'const compile = (ast, options = {}) => {' + guard);
patch('lib/expand.js', 'const expand = (ast, options = {}) => {', 'const expand = (ast, options = {}) => {' + guard);
patch('lib/stringify.js', 'module.exports = (ast, options = {}) => {', 'module.exports = (ast, options = {}) => {' + guard);
fs.writeFileSync(path.join(root, 'lib/bb-depth-guard.js'), `
'use strict';
module.exports = root => {
  const stack = [[root, 0]];
  const seen = new Set();
  let count = 0;
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (depth > 128 || seen.has(node) || ++count > 100000)
      throw new SyntaxError('Brace AST exceeds safe depth or contains a cycle');
    seen.add(node);
    if (Array.isArray(node.nodes)) for (const child of node.nodes) stack.push([child, depth + 1]);
  }
};
`);
console.log('braces 3.0.3: parse and AST depth guards applied (advisory remains visible).');
