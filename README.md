# 🔥 ChaufferieLog — Guide d'installation

Application PWA pour l'inventaire des équipements de chaufferie.
Fonctionne **hors ligne** sur iPhone et tous smartphones.

---

## 📦 Contenu du dossier

```
chaufferie-pwa/
├── index.html       ← Application principale
├── style.css        ← Styles
├── app.js           ← Logique applicative
├── sw.js            ← Service worker (offline)
├── manifest.json    ← Config PWA
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## 🚀 Mise en ligne GRATUITE (10 minutes)

### Option A — Netlify (recommandé, le plus simple)

1. Créez un compte sur **https://netlify.com** (gratuit)
2. Glissez-déposez le dossier `chaufferie-pwa/` sur la page d'accueil Netlify
3. Votre app est en ligne sur une URL type `https://xxx.netlify.app`

### Option B — GitHub Pages

1. Créez un compte **https://github.com**
2. Créez un nouveau dépôt (New repository)
3. Uploadez tous les fichiers
4. Allez dans Settings → Pages → Source: main
5. URL : `https://votre-nom.github.io/nom-du-depot`

---

## 📱 Installation sur iPhone

1. Ouvrez l'URL dans **Safari** (obligatoire sur iOS)
2. Appuyez sur **Partager** (icône carrée avec flèche ↑)
3. Choisissez **"Sur l'écran d'accueil"**
4. Appuyez sur **Ajouter**

L'app apparaît comme une vraie application sur votre iPhone ! ✅

---

## 🤖 Configuration Gemini (OCR amélioré, optionnel)

Pour une meilleure reconnaissance des plaques quand vous avez du réseau :

1. Allez sur **https://aistudio.google.com**
2. Cliquez sur **"Get API Key"** → créez une clé (gratuit)
3. Dans l'app → onglet **⚙️ Config** → collez votre clé
4. La clé est stockée **localement** sur votre téléphone

**Sans clé** : OCR Tesseract intégré fonctionne hors ligne (qualité moindre).

---

## 💾 Données

- Toutes les données sont stockées **localement** sur votre téléphone (IndexedDB)
- Aucun compte, aucun serveur, aucune connexion requise
- Export CSV disponible depuis l'icône ⬇️ en haut à droite

---

## ✨ Fonctionnalités

- 📷 **Scanner** les plaques signalétiques (caméra ou import photo)
- 🔍 **OCR hors-ligne** via Tesseract.js
- 🌐 **OCR Gemini** si réseau disponible (bien meilleur)
- 📋 **Fiches équipements** avec marque, modèle, n° série, puissance, fluide...
- 🗂️ **Catégories** : Chaudière, Brûleur, Pompe, Vanne, Échangeur, Ballon ECS...
- ✏️ **Catégories personnalisées** créables
- 📤 **Export CSV** compatible Excel
- 🔎 **Recherche** et filtrage par catégorie
