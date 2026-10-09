import { CamoufoxClient, type BrowserAdapter, type BrowserTab } from "./camoufox.js";
import type { ShopConfig } from "./config.js";

export type { BrowserAdapter, BrowserTab };

/** Transport utilisé par le client métier : une session Camoufox persistante pour les enseignes web. */
export function createBrowser(config: ShopConfig): BrowserAdapter {
  return new CamoufoxClient(config);
}
