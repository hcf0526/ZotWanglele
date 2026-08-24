# 开发约定

## 本地环境

项目以 Windows PowerShell 7、Node.js、npm 和 Zotero 10 为主要开发环境。

```powershell
npm install
npm run build
npm run lint:check
```

`npm start` 会按 `.env` 中的路径启动 Zotero 开发环境。`npm test` 需要
可用的 Zotero 测试 profile。

## 修改范围

- 生命周期与窗口初始化放在 `src/hooks.ts`。
- AI 调用放在 `src/modules/ai/ai-client.ts`。
- 条目菜单放在 `src/modules/reader/menu.ts`。
- PDF 翻译从 `src/modules/translate/translator.ts` 发起。
- 新增偏好设置时同步更新 `addon/prefs.js` 与 `typings/prefs.d.ts`。
- 新增界面文字时同步更新 `zh-CN` 与 `en-US` Fluent 文件。
- 功能状态变化时同步更新根 README 和对应阶段文档。

## 验证要求

- 常规 TypeScript 修改至少执行 `npm run build`。
- 格式或文档大改执行 `npm run lint:check`。
- Zotero 生命周期、菜单或窗口行为变化时执行 `npm test`，并在 Zotero 10 中
  完成人工验证。
- PDF 翻译使用 `test/attentionisallyouneed04.pdf` 作为当前样例。

## Commit 规范

标题沿用仓库历史格式：

```text
<类型符号> YYYY/MM/DD 概要
```

正文使用两位序号列出改动：

```text
01. 第一项改动
02. 第二项改动
03. 第三项改动
```

创建 commit、修改历史或推送远端均需用户明确授权。
