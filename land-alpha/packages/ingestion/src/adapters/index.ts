import { registerAdapter } from '../adapter.js';
import { arcgisParcelInventoryAdapter } from './arcgis-parcel-inventory.js';
import { arcgisTaxSalePointsAdapter } from './arcgis-tax-sale-points.js';
import { manualImportAdapter } from './manual-import.js';

/**
 * Adapter registration.
 *
 * Importing this module registers every adapter. Registry entries reference
 * adapters by `adapterKey`, so a new county that fits an existing shape needs
 * no code at all.
 */
registerAdapter(arcgisParcelInventoryAdapter);
registerAdapter(arcgisTaxSalePointsAdapter);
registerAdapter(manualImportAdapter);

export { arcgisParcelInventoryAdapter, arcgisTaxSalePointsAdapter, manualImportAdapter };
