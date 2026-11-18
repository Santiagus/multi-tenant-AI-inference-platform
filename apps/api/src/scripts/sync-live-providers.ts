#!/usr/bin/env node
/**
 * CLI script to consult all configured provider APIs and synchronize
 * available models, GPU offerings, execution modes, and pricing into PostgreSQL.
 *
 * Usage:
 *   node --env-file=.env apps/api/dist/scripts/sync-live-providers.js
 *   or via pnpm:
 *   pnpm --filter @platform/api run sync:providers
 */

import { loadConfig } from '../config/env.js';
import { DatabasePool } from '../infrastructure/db/pool.js';
import { LiveProviderCatalogService } from '../infrastructure/finops/live-provider-catalog.js';

async function main() {
  console.log('===========================================================');
  console.log('🤖 FinOps Live Provider Catalog Synchronization');
  console.log('===========================================================');
  console.log('Consulting live APIs across configured providers...');

  const config = loadConfig();
  const db = new DatabasePool(config);
  const service = new LiveProviderCatalogService(db);

  try {
    const start = Date.now();
    const result = await service.syncAll();
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    console.log(`\n✅ Synchronization completed successfully in ${duration}s!`);
    console.log(`- Providers synced: [${result.syncedProviders.join(', ')}]`);
    console.log(`- GPU Hardware snapshots written: ${result.gpuSnapshotsCount}`);
    console.log(`- Model catalog snapshots written: ${result.modelSnapshotsCount}`);
    console.log(`- Audit records written: ${result.auditRecordsCount}`);
    console.log(`- Recorded at: ${result.syncedAt}`);
    console.log('===========================================================');
    await db.close();
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ Fatal error during provider catalog synchronization:', err);
    await db.close();
    process.exit(1);
  }
}

main();
