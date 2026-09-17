/**
 * Applies pending migrations during the web build, when it can.
 *
 * The failure this exists to prevent: a deploy carries a Prisma client that
 * knows about a new column, the database does not have it yet, and every query
 * touching that table fails until something runs the migration. Migrations
 * otherwise run on the scheduled worker, and GitHub throttles that schedule to
 * roughly hourly — so "until something runs it" was an hour of a broken app,
 * with the failure landing on pages that have nothing to do with the change.
 *
 * Conditional on DIRECT_URL because migrating needs an unpooled connection:
 * Prisma holds an advisory lock for the duration and a transaction pooler does
 * not keep one. A deployment that has not set it keeps the old behaviour rather
 * than failing its build over a variable that used to be optional.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Vercel puts its variables in the real environment; a developer running this
// locally has them in .env, which nothing has loaded this early in the build.
if (!process.env.DIRECT_URL && existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

if (!process.env.DIRECT_URL) {
  console.warn(
    '[build] DIRECT_URL is not set, so migrations were not applied here. They will run on the ' +
      'worker instead — until then, a deploy that adds a column serves an app whose database ' +
      'does not have it. See docs/deploying.md.',
  );
  process.exit(0);
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
// Deliberately fatal: shipping code that needs a migration which did not apply
// is the exact breakage this script exists to prevent, and a green build would
// hide it until someone opened the wrong page.
process.exit(result.status ?? 1);
