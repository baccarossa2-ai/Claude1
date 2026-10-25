// Extracts the Cloudee avatar ES module (engine + data) from the cloudy.chat chunk.
const fs = require('fs');
const [,, chunkPath, outPath] = process.argv;
const s = fs.readFileSync(chunkPath, 'utf8');
// avatar data object: starts at ",r={version:1" ... ends before the first top-level ",l=" or similar; parse by brace matching
const rStart = s.indexOf('r={version:1') + 2;
let depth = 0, i = rStart, inStr = null;
for (; i < s.length; i++) {
  const c = s[i];
  if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
  if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
}
const dataSrc = s.slice(rStart, i);
const data = (new Function('return (' + dataSrc + ')'))();
// module string expression: from 'let n="var AvatarProceduralEngine' to ',i=URL.createObjectURL'
const nStart = s.indexOf('let n="var AvatarProceduralEngine') + 6;
const nEnd = s.indexOf(',i=URL.createObjectURL', nStart);
const expr = s.slice(nStart, nEnd);
const mod = (new Function('e', 'return (' + expr + ')'))(data);
fs.writeFileSync(outPath, '// Cloudee avatar runtime — extracted from cloudy.chat (Cloudy, MIT).\n' + mod + '\n');
console.log('animations:', Object.keys(data.animations), 'expressions:', Object.keys(data.expressions).length, 'colors:', JSON.stringify(data.avatar.colors), 'bytes:', mod.length);
