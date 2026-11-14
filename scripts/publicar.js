// Publica una versión nueva: sube el número de versión, hace commit, crea el tag y hace push.
// GitHub Actions compila el instalador y lo publica; la app instalada se actualiza sola.
//
//   npm run publicar                → 0.2.0 → 0.2.1 (arreglos)
//   npm run publicar -- minor       → 0.2.1 → 0.3.0 (funciones nuevas)
//   npm run publicar -- major       → 0.3.0 → 1.0.0
//   npm run publicar -- 0.4.2       → versión exacta
//   npm run publicar -- minor "Respaldos y estadísticas"   → con mensaje
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const [kind = 'patch', ...msgParts] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const next = /^\d+\.\d+\.\d+$/.test(kind) ? kind
  : kind === 'major' ? `${ma + 1}.0.0`
  : kind === 'minor' ? `${ma}.${mi + 1}.0`
  : kind === 'patch' ? `${ma}.${mi}.${pa + 1}`
  : null;
if (!next) { console.error(`No entiendo "${kind}". Usa patch, minor, major o un número como 0.3.0`); process.exit(1); }

const branch = out('git rev-parse --abbrev-ref HEAD');
if (out(`git tag --list v${next}`)) { console.error(`Ya existe la versión v${next}.`); process.exit(1); }

console.log(`\nPublicando ${pkg.version} → ${next} (rama ${branch})\n`);
pkg.version = next;
fs.writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
run('npm install --package-lock-only --no-audit --no-fund'); // que package-lock.json tenga la misma versión

// Nunca se suben .env, data/ ni tu configuración personal (lo cubre .gitignore)
run('git add -A');
const message = msgParts.join(' ').trim() || `Versión ${next}`;
run(`git commit -m "${message.replace(/"/g, "'")}"`);
run(`git tag v${next}`);
run(`git push origin ${branch}`);
run(`git push origin v${next}`);

console.log(`\n✅ Listo. GitHub está creando el instalador de la v${next} (tarda ~5 min).`);
console.log('   Puedes verlo en: https://github.com/SopaHeladaGames/stream-interact/actions');
console.log('   Cuando termine, la app instalada lo descargará sola y te avisará.\n');
