// tests/harness/extract.js
// index.js starts the whole server when required and exports nothing, so unit tests cannot `require` it.
// Instead we cut single top-level functions out of the REAL source text and run them in a vm with
// stub globals. The code under test is therefore the production code, byte for byte - no copy to drift.
'use strict';
const fs = require('fs');
const vm = require('vm');

/** Return the source of `function name(...) {...}` (or `async function`), skipping strings/comments/templates. */
function grabFunction(src, name) {
    const re = new RegExp(`(?:^|\\n)((?:async\\s+)?function\\s+${name}\\s*\\()`);
    const m = re.exec(src);
    if (!m) throw new Error(`function ${name} not found`);
    const start = m.index + m[0].indexOf(m[1]);
    let i = src.indexOf('{', src.indexOf(')', start));
    let depth = 0;
    const stack = [];            // template-literal nesting
    for (; i < src.length; i++) {
        const c = src[i], n = src[i + 1];
        if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
        if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
        if (c === '"' || c === "'") {
            for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
            continue;
        }
        if (c === '`') {
            for (i++; i < src.length; i++) {
                if (src[i] === '\\') { i++; continue; }
                if (src[i] === '`') break;
                if (src[i] === '$' && src[i + 1] === '{') {   // ${ ... } may contain braces/strings: recurse by depth counting
                    let d = 1; i += 2;
                    for (; i < src.length && d > 0; i++) {
                        if (src[i] === '{') d++;
                        else if (src[i] === '}') d--;
                        else if (src[i] === '"' || src[i] === "'") { const q = src[i]; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++; }
                    }
                    i--;
                }
            }
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error(`unbalanced braces while reading ${name}`);
}

/** Return the one-line statement `const NAME = ...;` as written in the source. */
function grabConst(src, name) {
    const m = new RegExp(`^(?:const|let)\\s+${name}\\s*=.*?;`, 'm').exec(src);
    if (!m) throw new Error(`const ${name} not found`);
    return m[0];
}

/**
 * Build a vm context containing the named functions/consts from `file` plus the given stub globals.
 * Everything returned by `exports` is read back out of the context.
 */
function load(file, { functions = [], consts = [], globals = {} } = {}) {
    const src = fs.readFileSync(file, 'utf8');
    const ctx = vm.createContext({ console, Math, Number, Array, Set, Map, Int32Array, Int16Array, Uint8Array, JSON, ...globals });
    const code = [...consts.map(c => grabConst(src, c)), ...functions.map(f => grabFunction(src, f))].join('\n');
    vm.runInContext(code, ctx, { filename: file });
    return ctx;
}

module.exports = { grabFunction, grabConst, load };
