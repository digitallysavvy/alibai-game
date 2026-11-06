import { readdir, readFile } from 'node:fs/promises';
import { fixtures } from '../../lib/scenarios/fixtures';
import { validateCaseSet, validateScenario } from '../../lib/scenarios/validate';
import type { Scenario } from '../../lib/scenarios/schema';
async function main() {
  const cases: { name: string; data: unknown }[] = fixtures.map(s => ({ name: s.title, data: s }));
  const directory = process.argv[2] ?? 'game-scenarios/generated';
  for (const file of await readdir(directory).catch(() => [] as string[])) {
   if (!file.endsWith('.json') || file.endsWith('.review.json')) continue;
   try { cases.push({ name: file, data: JSON.parse(await readFile(`${directory}/${file}`, 'utf8')) }); }
   catch { console.error(`${file}: invalid JSON`); process.exitCode = 1; }
  }
  const seen: Scenario[] = [];
  for (const { name, data } of cases) {
   // A persisted copy of the exact same immutable fixture is not a new duplicate case.
   const id = (data as { scenarioId?: string })?.scenarioId;
   const comparison = seen.filter(s => s.scenarioId !== id);
   const result = validateScenario(data, comparison);
   if (!result.valid) { console.error(`${name}: ${result.errors.join('; ')}`); process.exitCode = 1; }
   else if ('scenario' in result) { seen.push(result.scenario); console.log(`VALID ${name}`); }
  }
  for (const error of validateCaseSet(fixtures)) { console.error(`Case set: ${error}`); process.exitCode = 1; }
  console.log(`Checked ${cases.length} fixture/generated records.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Unknown CLI error'); process.exitCode = 1; });
