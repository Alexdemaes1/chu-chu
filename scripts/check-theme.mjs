#!/usr/bin/env node
/**
 * Comprueba que ningún componente usa las clases del antiguo tema oscuro.
 * Recorre src/**\/*.tsx y termina con código 1 listando fichero:línea si encuentra alguna.
 * Uso: npm run lint:theme
 */
import {readdirSync, readFileSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

const FORBIDDEN =
  /(bg-slate-(950|900|800|700)|text-slate-(100|200|300)|border-slate-(800|700)|text-(cyan|amber|emerald|pink|rose)-(100|200|300|400)\b|bg-(cyan|amber|emerald|pink|rose)-950|bg-\[#0|bg-black\/|text-\[#fff\]|text-\[(8|9|10)px\])/g;

function* walk(dir) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      yield full;
    }
  }
}

const problems = [];
let fileCount = 0;

for (const file of walk(SRC)) {
  fileCount += 1;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const matches = [...line.matchAll(FORBIDDEN)].map((match) => match[0]);
    if (matches.length > 0) {
      const path = relative(ROOT, file).split(sep).join('/');
      problems.push(`${path}:${index + 1}  ${[...new Set(matches)].join(', ')}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`lint:theme: ${problems.length} línea(s) con clases del tema oscuro antiguo:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nSustitúyelas por los tokens semánticos (ver «Tema visual» en CLAUDE.md).');
  process.exit(1);
}

console.log(`lint:theme: sin clases del tema oscuro en ${fileCount} fichero(s) .tsx.`);
