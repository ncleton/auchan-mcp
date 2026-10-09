# Auchan MCP

Serveur MCP et CLI non officiels pour [Auchan](https://www.auchan.fr) : chercher le catalogue actuel, lire les fiches produit et préparer le panier dans une session web Camoufox persistante qui appartient à l’utilisateur.

Courses en drive : le catalogue, les prix et les stocks dépendent du drive Auchan choisi sur le site officiel, que le MCP vérifie avant chaque lecture ou écriture.

## Achat en ligne

Modes de réception proposés par Auchan : retrait en magasin ou en point de retrait (click and collect). Retrait en drive : le catalogue, les prix et les stocks sont ceux du drive choisi sur le site officiel. Le créneau de retrait et le paiement se choisissent sur auchan.fr au moment de valider le panier.

Un compte Auchan est facultatif pour remplir un panier ; il devient nécessaire pour finaliser la commande et choisir le mode de réception.

Le MCP ne choisit aucun créneau, ne valide aucune commande et ne réalise aucun paiement : il remplit et relit le panier, la commande se termine sur le site officiel.

## Capacités

- `connect_auchan` : ouvre Auchan dans le profil Camoufox isolé et propose le wizard local de connexion ou de création de compte ;
- `session_status` : prouve Camoufox, le site officiel, son périmètre exact et l’état de connexion visible ;
- `search_products` : retourne les produits actuels, leur prix et leur disponibilité ;
- `get_product` : lit une fiche retournée par la recherche (ingrédients, EAN, nutrition lorsqu’ils sont publiés) ;
- `get_cart` : lit le panier sans exposer l’identité, l’adresse, le créneau ou le paiement ;
- `add_to_cart` : prévisualise puis ajoute une fiche fraîche après confirmation ;
- `remove_from_cart` : prévisualise puis retire un produit présent après confirmation.

## Prérequis

- Node.js 22.12 ou supérieur ;
- `camofox-browser` 2.4.6 ou une version compatible ;
- un compte Auchan autorisé par son propriétaire (facultatif pour remplir un panier) ;
- le nom exact du drive déjà choisi dans la fenêtre Camoufox sur auchan.fr (bouton « Choisir vos courses ») ;

Installation de Camoufox :

```bash
npm install --global camofox-browser@2.4.6
```

Créez une clé aléatoire forte dans votre gestionnaire de secrets, puis démarrez le service local avec `CAMOFOX_AUTH_MODE=required` et `CAMOFOX_API_KEY` définis dans son environnement :

```bash
camofox server start --background
```

Ne transmettez jamais cette clé, vos cookies, votre mot de passe, un code 2FA ou un CAPTCHA à un assistant.

## Installation du MCP

```bash
git clone https://github.com/ncleton/auchan-mcp.git
cd auchan-mcp
npm ci
npm run build
cp .env.example .env
```

Renseignez localement `.env` :

- `AUCHAN_DRIVE_NAME` : Nom du drive Auchan choisi sur le site officiel, tel qu’il apparaît dans l’en-tête. Exemple : `Auchan Drive Villeneuve D'Ascq (Lezennes)` ;
- `CAMOFOX_USER_ID` : identifiant unique pour cette personne et ce compte ;
- `CAMOFOX_URL` : normalement http://127.0.0.1:9377 ;
- `CAMOFOX_AUTH_MODE` : obligatoire ;
- `CAMOFOX_API_KEY` : la même clé forte que le service Camoufox (32 caractères minimum) ;

## Première connexion

```bash
npm run build
node dist/cli.js connect
```

Camoufox ouvre Auchan dans son profil persistant. Saisissez vous-même vos identifiants et éventuels codes dans la fenêtre du navigateur, puis vérifiez :

```bash
node dist/cli.js status
node dist/cli.js search "tofu" --limit 5
node dist/cli.js cart
```

Une mutation CLI est toujours prévisualisée. Après vérification du delta, relancez exactement la même commande avec `--confirm` :

```bash
node dist/cli.js add '<product_url retourné par search>' --quantity 1
node dist/cli.js add '<même product_url>' --quantity 1 --confirm
node dist/cli.js remove '<product_id retourné par cart>' --quantity 1
node dist/cli.js remove '<même product_id>' --quantity 1 --confirm
```

Dans MCP, le premier appel à `add_to_cart` ou `remove_from_cart` retourne un jeton expirant après cinq minutes. Le second appel doit reprendre exactement les mêmes paramètres et ce jeton. Toute modification intermédiaire du panier invalide la confirmation.

## Configuration MCP

Exemple recommandé pour un client MCP utilisant directement la release publique `v0.1.0` en `stdio` :

```json
{
  "mcpServers": {
    "auchan": {
      "command": "npx",
      "args": [
        "-y",
        "--package=github:ncleton/auchan-mcp#v0.1.0",
        "auchan-mcp"
      ],
      "env": {
        "AUCHAN_DRIVE_NAME": "Auchan Drive Villeneuve D'Ascq (Lezennes)",
        "CAMOFOX_USER_ID": "auchan-personal",
        "CAMOFOX_URL": "http://127.0.0.1:9377",
        "CAMOFOX_AUTH_MODE": "required",
        "CAMOFOX_API_KEY": "référence-vers-votre-secret-local"
      }
    }
  }
}
```

Préférez le gestionnaire de secrets du client MCP à une clé écrite en clair dans sa configuration.

## Contrat observé

- Site rendu côté serveur : la recherche lit les vignettes de `/recherche?text=` (`article.product-thumbnail`, métadonnées schema.org pour le prix et la disponibilité, `data-product-id`, `data-offer-id`, `data-seller-id` et `data-stock` sur le sélecteur de quantité), la fiche vient de la page produit (`pr-C…`).
- Le panier se lit par `GET /cart?cartId=<cookie lark-cart>` ; sans l’identifiant du cookie, le site répond par un panier vide neuf à chaque appel. `POST /cart/update` crée, modifie ou supprime une ligne (`desiredQuantity` à 0 pour supprimer) et le panier réel est relu avant et après chaque écriture.
- Le drive affiché dans l’en-tête (`.context-header__pos`) doit correspondre à `AUCHAN_DRIVE_NAME` : sinon le MCP s’arrête avec `scope_required` ou `scope_mismatch` au lieu de lire un autre catalogue.
- Les lignes du panier ne publient pas le nom du produit : `get_cart` retourne `name: null` et la prévisualisation d’ajout indique le nom lu sur la fiche.
- Les prix du panier sont en centimes et convertis en euros ; les remises fidélité, coupons et frais éventuels s’affichent sur le site officiel à la validation.

## Limites et erreurs explicites

Camoufox limite par défaut `evaluate-extended` à 20 appels par profil et par minute. Le client sérialise les lectures. Si la limite est atteinte, il renvoie `rate_limited` et le délai de reprise fourni par Camoufox ; il ne bascule jamais vers un autre compte, un autre périmètre ou des données en cache.

Une page de connexion, un CAPTCHA ou une protection anti-robot produit `authentication_required` avec l’action manuelle attendue. Une évolution du contrat du site produit `contract_changed` au lieu d’inventer une réponse.

## Développement et validation

```bash
npm run verify
```

Cette commande exécute le typage, les tests, un échange avec le SDK MCP officiel, l’audit de confidentialité et l’inspection du paquet npm. `npm run live:smoke` ajoute puis retire un produit réel du panier de la session configurée et vérifie le retour exact à l’état initial.

## Statut juridique

Projet non officiel, sans affiliation ni approbation de Auchan. L’utilisateur reste responsable de respecter les conditions du service et de n’utiliser que son propre compte et ses propres sessions.
