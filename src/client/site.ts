import {
  ROBOT_PATTERN, decodeHtml, formatEuro, hasVeganClaim, isObject, isOrganic, parsePrice, str, stripTags,
  type Adapter, type MutationInput, type SessionSignals,
} from "./adapter.js";
import type { ShopConfig } from "./config.js";
import { ContractChangedError, ShopError } from "./errors.js";
import type { CartInput, ProductInput, SummaryInput } from "./types.js";

const HOST = "www.auchan.fr";
const ORIGIN = `https://${HOST}`;

const PRELUDE = String.raw`
const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
const cookie = (name) => { const found = document.cookie.split(";").map((part) => part.trim()).find((part) => part.indexOf(name + "=") === 0); return found ? decodeURIComponent(found.slice(name.length + 1)) : ""; };
const parse = (html) => new DOMParser().parseFromString(html, "text/html");
const driveOf = (doc) => clean((doc.querySelector(".context-header__pos") || {}).textContent);
const productFrom = (selector) => ({ product_id: selector.getAttribute("data-product-id"), offer_id: selector.getAttribute("data-offer-id"), seller_id: selector.getAttribute("data-seller-id"), seller_type: selector.getAttribute("data-seller-type"), stock: selector.getAttribute("data-stock"), disabled: /disabled/.test(selector.className) || selector.getAttribute("data-disable-button") === "true" });
const readCart = async () => {
  const cartId = cookie("lark-cart");
  if (!cartId) throw new Error("Cookie de panier lark-cart absent : ouvrez auchan.fr dans Camoufox");
  const response = await fetch("/cart?cartId=" + encodeURIComponent(cartId), { headers: { Accept: "application/json" }, credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Panier HTTP " + response.status);
  const json = await response.json();
  const cart = json && json.cart && json.cart.cart;
  if (!cart || cart.id !== cartId || !Array.isArray(cart.items) || !cart.prices || !cart.prices.totalPrice) throw new Error("Contrat panier absent ou identifiant inattendu");
  return {
    cart_id: cart.id, total: cart.prices.totalPrice.amount,
    items: cart.items.map((line) => ({
      line_id: line.id, id: line.productId, offer_id: line.offerId, quantity: line.desiredQuantity, unit_price: line.offering && line.offering.prices && line.offering.prices.price ? line.offering.prices.price.amount : null,
      line_total: line.offering && line.offering.prices && line.offering.prices.totalPrice ? line.offering.prices.totalPrice.amount : null, max_quantity: line.offering ? line.offering.maxQuantity : null,
      seller_id: line.offering && line.offering.context && line.offering.context.seller ? line.offering.context.seller.id : null, seller_type: line.offering && line.offering.context && line.offering.context.seller ? line.offering.context.seller.type : null,
    })),
  };
};
const update = async (cart, items) => {
  const response = await fetch("/cart/update", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ cartId: cart.cart_id, items: items, consentId: cookie("lark-consentId"), reservationId: null, mbaAvailabilityNeeded: true }) });
  if (!response.ok) throw new Error("Écriture du panier HTTP " + response.status);
  return response.json();
};
`;

function searchExpression(query: string, limit: number): string {
  return String.raw`(async () => {
    ${PRELUDE}
    const response = await fetch("/recherche?text=" + encodeURIComponent(${JSON.stringify(query)}), { credentials: "include" });
    if (!response.ok) throw new Error("Recherche HTTP " + response.status);
    const doc = parse(await response.text());
    const drive = driveOf(doc);
    const cards = Array.prototype.slice.call(doc.querySelectorAll("article.product-thumbnail"));
    if (!cards.length && !/aucun r[ée]sultat|0 produit/i.test(clean(doc.body && doc.body.textContent))) throw new Error("Contrat liste produits absent");
    const products = cards.map((card) => {
      const selector = card.querySelector(".quantity-selector[data-product-id]");
      const link = card.querySelector("a.product-thumbnail__details-wrapper[href]");
      const description = card.querySelector(".product-thumbnail__description");
      if (!selector || !link || !description) return null;
      const brand = description.querySelector("[itemprop='brand']");
      const price = card.querySelector("meta[itemprop='price']");
      const availability = card.querySelector("meta[itemprop='availability']");
      const attributes = card.querySelector(".product-thumbnail__attributes");
      const attributeText = clean(attributes && attributes.textContent);
      const perUnit = attributeText.match(/\d+(?:[.,]\d+)?\s*€\s*\/\s*\w+/);
      return Object.assign(productFrom(selector), {
        name: clean(description.textContent), brand: brand ? clean(brand.textContent) : null, price: price ? price.getAttribute("content") : null, in_stock: !!availability && /InStock/.test(availability.getAttribute("content") || ""),
        per_unit: perUnit ? perUnit[0] : null, format: Array.prototype.slice.call(card.querySelectorAll(".product-attribute")).map((node) => clean(node.textContent)).filter(Boolean).join(" "), url: new URL(link.getAttribute("href"), location.origin).toString(),
      });
    }).filter(Boolean);
    if (!products.length) return [{ no_results: true, drive: drive }];
    return products.slice(0, ${limit}).map((product) => Object.assign(product, { drive: drive }));
  })()`;
}

function productExpression(productUrl: string): string {
  return String.raw`(async () => {
    ${PRELUDE}
    const response = await fetch(${JSON.stringify(productUrl)}, { credentials: "include" });
    if (!response.ok) throw new Error("Fiche HTTP " + response.status);
    const doc = parse(await response.text());
    const selector = doc.querySelector(".quantity-selector[data-product-id]");
    const title = doc.querySelector("h1");
    const price = doc.querySelector("meta[itemprop='price']");
    const availability = doc.querySelector("meta[itemprop='availability']");
    if (!selector || !title) throw new Error("Contrat fiche produit absent");
    const text = clean(doc.body && doc.body.textContent);
    const marker = /Ingr[ée]dients\s*/i.exec(text);
    let ingredients = null;
    if (marker) {
      const rest = text.slice(marker.index + marker[0].length);
      const stop = /(?:Valeurs nutritionnelles|Informations nutritionnelles|Allerg[èe]nes?|Conservation|Mode d.emploi|Origine|Avis clients|Description|Caract[ée]ristiques)\b/i.exec(rest);
      ingredients = rest.slice(0, stop ? stop.index : 1200).trim() || null;
    }
    const ean = text.match(/EAN\s*:\s*[^/]*\/\s*(\d{13})/);
    const brand = doc.querySelector("[itemprop='brand']");
    return Object.assign(productFrom(selector), { drive: driveOf(doc), name: clean(title.textContent), brand: brand ? clean(brand.textContent) : null, price: price ? price.getAttribute("content") : null, in_stock: !!availability && /InStock/.test(availability.getAttribute("content") || ""), ean: ean ? ean[1] : null, ingredients: ingredients });
  })()`;
}

function cartExpression(): string {
  return String.raw`(async () => { ${PRELUDE} return readCart(); })()`;
}

function mutationExpression(input: MutationInput): string {
  return String.raw`(async () => {
    ${PRELUDE}
    const productId = ${JSON.stringify(input.productId)};
    const productUrl = ${JSON.stringify(input.productUrl)};
    const target = ${input.targetQuantity};
    const before = await readCart();
    const line = before.items.find((item) => item.id === productId);
    const current = line ? Number(line.quantity) : 0;
    if (current === target) return { before: before, after: before, applied: false };
    let item;
    if (line) item = { id: line.line_id, productId: productId, offerId: line.offer_id, sellerId: line.seller_id, sellerType: line.seller_type, desiredQuantity: target, desiredType: "DEFAULT" };
    else {
      if (!productUrl) throw new Error("Adresse de fiche requise pour ajouter un nouveau produit");
      const response = await fetch(productUrl, { credentials: "include" });
      if (!response.ok) throw new Error("Fiche HTTP " + response.status);
      const selector = parse(await response.text()).querySelector(".quantity-selector[data-product-id='" + productId + "']");
      if (!selector) throw new Error("Produit introuvable sur sa fiche");
      const product = productFrom(selector);
      item = { productId: productId, offerId: product.offer_id, sellerId: product.seller_id, sellerType: product.seller_type, desiredQuantity: target, desiredType: "DEFAULT" };
    }
    await update(before, [item]);
    return { before: before, after: await readCart(), applied: true };
  })()`;
}

function sameDrive(left: string, right: string): boolean {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(left) === normalize(right);
}

function assertDrive(config: ShopConfig, visible: unknown): void {
  const expected = config.scope.drive_name;
  const name = typeof visible === "string" ? visible.trim() : "";
  if (!name) {
    throw new ShopError("Aucun drive Auchan n’est sélectionné.", "scope_required", `Dans la fenêtre Camoufox, ouvrez auchan.fr, cliquez sur « Choisir vos courses » et sélectionnez le drive « ${expected} », puis relancez.`);
  }
  if (!sameDrive(name, expected)) {
    throw new ShopError(`Le drive visible est « ${name} », pas « ${expected} ».`, "scope_mismatch", "Dans la fenêtre Camoufox, sélectionnez le drive configuré dans AUCHAN_DRIVE_NAME, ou corrigez cette variable, puis relancez.");
  }
}

const centimes = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value / 100 : null);

function availabilityOf(entry: Record<string, unknown>): "available" | "out_of_stock" {
  return entry.in_stock === true && entry.disabled !== true && Number(entry.stock) > 0 ? "available" : "out_of_stock";
}

export const adapter: Adapter = {
  entryUrl: () => `${ORIGIN}/`,
  matchesTab: (u) => u.protocol === "https:" && u.hostname === HOST,
  validateScope(scope) {
    if (!scope.drive_name || scope.drive_name.trim().length < 5) throw new ShopError("AUCHAN_DRIVE_NAME est absent ou trop court.", "invalid_configuration", "Renseignez le nom du drive tel qu’il apparaît dans l’en-tête d’auchan.fr (par exemple « Auchan Drive Villeneuve D'Ascq (Lezennes) »).");
  },
  scopeLabel: (config) => config.scope.drive_name,
  inspectSession({ snapshot, tabUrl }): SessionSignals {
    let onSite = false;
    try { onSite = new URL(tabUrl).hostname === HOST; } catch { onSite = false; }
    const robotVisible = ROBOT_PATTERN.test(snapshot);
    return { ready: onSite && !robotVisible && snapshot.trim().length > 0, robotVisible, accountConnected: !/me connecter/i.test(snapshot) && /mon compte|d[ée]connexion/i.test(snapshot) };
  },
  validateProductUrl(u) {
    if (u.protocol !== "https:" || u.hostname !== HOST || !/\/pr-C\d+$/.test(u.pathname)) throw new Error("Hors des fiches produit Auchan.");
  },
  searchExpression: (_config, query, limit) => searchExpression(query, limit),
  normalizeSearch(raw, config): SummaryInput[] {
    if (!Array.isArray(raw)) throw new ContractChangedError("La recherche n’a pas retourné une liste de produits.");
    if (!raw.length || !isObject(raw[0])) throw new ContractChangedError("La recherche n’a pas retourné de contexte de drive.");
    assertDrive(config, raw[0].drive);
    if (raw[0].no_results === true) return [];
    return raw.map((entry): SummaryInput => {
      if (!isObject(entry)) throw new ContractChangedError("Un produit n’est plus un objet exploitable.");
      const id = str(entry, "product_id");
      const name = str(entry, "name");
      const price = parsePrice(entry.price);
      const url = str(entry, "url");
      if (!id || !name || price === null || !url || typeof entry.in_stock !== "boolean") throw new ContractChangedError("Un produit ne contient plus son identifiant, son nom, son prix, son adresse ou sa disponibilité.");
      const stock = Number(entry.stock);
      return {
        product_id: id, name: decodeHtml([name, str(entry, "format")].filter(Boolean).join(" — ")), brand: str(entry, "brand"), price, unit_price: str(entry, "per_unit"),
        availability: availabilityOf(entry), available_quantity: Number.isInteger(stock) && stock >= 0 ? stock : null, organic: isOrganic(name), product_url: url,
      };
    });
  },
  productExpression: (_config, productUrl) => productExpression(productUrl),
  normalizeProduct(raw, config, requestedUrl): ProductInput {
    if (!isObject(raw)) throw new ContractChangedError("La fiche n’a pas retourné l’objet produit attendu.");
    assertDrive(config, raw.drive);
    const id = str(raw, "product_id");
    const name = str(raw, "name");
    const price = parsePrice(raw.price);
    if (!id || !name || price === null || typeof raw.in_stock !== "boolean") throw new ContractChangedError("La fiche ne contient plus son identifiant, son nom, son prix ou sa disponibilité.");
    const ean = str(raw, "ean");
    const stock = Number(raw.stock);
    const text = `${str(raw, "brand") ?? ""} ${name}`;
    return {
      product_id: id, name: decodeHtml(text.trim()), brand: str(raw, "brand"), price, unit_price: null,
      availability: availabilityOf(raw), available_quantity: Number.isInteger(stock) && stock >= 0 ? stock : null, organic: isOrganic(name), product_url: requestedUrl,
      ean: ean && /^\d{13}$/.test(ean) ? ean : null, ingredients: str(raw, "ingredients"), vegan_claim: hasVeganClaim(stripTags(text)), nutrition: [],
    };
  },
  cartExpression: () => cartExpression(),
  normalizeCart(raw): CartInput {
    if (!isObject(raw) || !Array.isArray(raw.items)) throw new ContractChangedError("Le panier n’a plus la forme observée.");
    const total = centimes(raw.total);
    if (total === null) throw new ContractChangedError("Le total du panier n’est plus publié.");
    const items = raw.items.map((entry) => {
      if (!isObject(entry)) throw new ContractChangedError("Une ligne de panier n’est plus exploitable.");
      const id = str(entry, "id");
      const quantity = Math.round(Number(entry.quantity));
      if (!id || !Number.isInteger(quantity) || quantity < 0) throw new ContractChangedError("Une ligne de panier ne contient plus son identifiant ou sa quantité.");
      const maximum = Number(entry.max_quantity);
      return { product_id: id, name: null, quantity, available_quantity: Number.isInteger(maximum) && maximum >= 0 ? maximum : null, unit_price: centimes(entry.unit_price), line_total: centimes(entry.line_total) };
    });
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    return { empty: totalQuantity === 0, total_quantity: totalQuantity, total_price: formatEuro(total), items };
  },
  mutationExpression: (_config, input: MutationInput) => mutationExpression(input),
};
