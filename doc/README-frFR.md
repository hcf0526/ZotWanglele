# ZotWanglele

ZotWanglele est une extension personnelle pour Zotero 9 consacrée à la lecture
assistée par IA et à la traduction de fichiers PDF. Le projet utilise
TypeScript, zotero-plugin-scaffold et zotero-plugin-toolkit.

## Fonctions disponibles

- Profils multiples pour les services compatibles OpenAI.
- Formats Chat Completions et Responses.
- Lecture d'un PDF à partir de l'index plein texte de Zotero.
- Résumé et analyse enregistrés comme notes enfants.
- Traduction avec `pdf2zh` ou `pdf2zh_next`.
- Exécution locale avec `uv` ou utilisation d'un serveur zotero-pdf2zh.
- Service de traduction `google` de PDFMathTranslate par défaut, indépendant
  des profils d'IA.
- Tableau des tâches de traduction et réglages avancés.

## État du projet

La version actuelle est `0.1.0`. L'analyse multimodale, le dialogue, les
revues bibliographiques, les outils de gestion, les cartes mentales et le
panneau latéral restent planifiés.

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

Le projet cible Zotero 9 et produit un fichier `.xpi` dans
`.scaffold/build/`.
