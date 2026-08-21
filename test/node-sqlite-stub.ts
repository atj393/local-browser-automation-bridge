/**
 * Unit tests never touch the database. Vite 5 does not classify `node:sqlite`
 * (Node >= 22.5) as a builtin and fails to resolve it, so vitest.config.ts
 * aliases it here.
 *
 * Every member throws. That is deliberate: it keeps the unit suite pure by
 * construction, so a test that quietly starts depending on SQLite fails loudly
 * instead of opening a real database file.
 */
const refuse = (): never => {
  throw new Error(
    'node:sqlite is stubbed in unit tests. This suite is for pure logic only — ' +
      'anything needing a real database belongs in an integration test.',
  );
};

export class DatabaseSync {
  constructor() {
    refuse();
  }
}

export default { DatabaseSync };
