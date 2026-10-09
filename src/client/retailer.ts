// Fichier généré par generate.mjs à partir de retailers/auchan/spec.json. Ne pas modifier ici.
export interface ScopeField { key: string; env: string; description: string; example: string; pattern?: string }
export const RETAILER: {
  id: string; slug: string; version: string; label: string; origin: string; entryUrl: string; loginUrl: string; signupUrl: string;
  platform: string; fulfillment: ReadonlyArray<"delivery" | "click_and_collect">; accountRequired: boolean;
  scopeFields: ReadonlyArray<ScopeField>;
} = {
  "id": "auchan",
  "slug": "auchan",
  "version": "0.1.0",
  "label": "Auchan",
  "origin": "https://www.auchan.fr",
  "entryUrl": "https://www.auchan.fr/",
  "loginUrl": "https://www.auchan.fr/client/panel",
  "signupUrl": "https://www.auchan.fr/client/panel",
  "platform": "auchan-lark",
  "fulfillment": [
    "click_and_collect"
  ],
  "accountRequired": false,
  "scopeFields": [
    {
      "key": "drive_name",
      "env": "AUCHAN_DRIVE_NAME",
      "description": "Nom du drive Auchan choisi sur le site officiel, tel qu’il apparaît dans l’en-tête.",
      "example": "Auchan Drive Villeneuve D'Ascq (Lezennes)"
    }
  ]
};
