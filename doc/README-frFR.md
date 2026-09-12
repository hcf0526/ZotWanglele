# ZotWanglele

ZotWanglele est une extension personnelle pour Zotero 10 consacrée à la lecture
assistée par IA et à la traduction de fichiers PDF. Le projet utilise
TypeScript, zotero-plugin-scaffold et zotero-plugin-toolkit.

## Fonctions disponibles

- Profils multiples pour les services compatibles OpenAI.
- Formats Chat Completions et Responses.
- Configuration IA partagée entre le deuxième onglet du tableau de bord et les préférences de l'extension.
- Traduction du texte sélectionné dans un PDF avec IA, Google (expérimental), DeepL ou Baidu ; affichage dans la fenêtre de sélection et le panneau latéral, annulation, copie et cache de session.
- Lecture d'un PDF à partir de l'index plein texte de Zotero.
- Résumé et analyse enregistrés comme notes enfants.
- Traduction avec `pdf2zh` ou `pdf2zh_next`.
- Exécution locale avec `uv` ou utilisation d'un serveur zotero-pdf2zh.
- Service de traduction `google` de PDFMathTranslate par défaut, indépendant
  des profils d'IA.
- Tableau des tâches et réglages distincts pour la traduction des documents et du texte sélectionné.

## État du projet

La version actuelle est `0.1.7`. Le panneau latéral de notes IA, la gestion des
prompts intégrés et les modèles personnalisés sont disponibles. L'analyse
multimodale, le dialogue et les cartes mentales restent planifiés.

La documentation principale est disponible dans
[README.md](../README.md). Les étapes de développement sont décrites dans
[doc/plan](plan/00-总览与功能合并.md).

## Développement

```powershell
npm install
npm run build
npm run lint:check
npm test
```

Le projet cible Zotero 10 et produit un fichier `.xpi` dans
`.scaffold/build/`.
