import { assert } from "chai";
import { agentSession } from "../src/modules/agent/session";

describe("agent chat session", function () {
  it("adds, snapshots and removes context items while keeping message history", function () {
    agentSession.clearContext();
    agentSession.clearMessages();

    const textEntry = agentSession.addTextContext(
      "Attention is all you need.",
      "阅读器划词",
    );
    assert.isOk(textEntry);
    assert.lengthOf(agentSession.getContext(), 1);
    assert.equal(agentSession.getContext()[0].kind, "text");

    // 模拟条目上下文（不依赖 Zotero Items 运行时）
    (agentSession as any).context.push({
      id: "ctx_item_test",
      kind: "item",
      label: "测试论文",
      itemId: 1,
      source: "文献条目",
      addedAt: Date.now(),
    });
    assert.lengthOf(agentSession.getContext(), 2);

    const messages = (agentSession as any).messages;
    messages.push({
      id: "msg_1",
      role: "user",
      content: "这篇论文的核心贡献是什么？",
      contextIds: [textEntry!.id, "ctx_item_test"],
    });
    messages.push({
      id: "msg_2",
      role: "assistant",
      content: "核心贡献是提出 Transformer。",
      contextIds: [textEntry!.id, "ctx_item_test"],
      modelLabel: "测试/模型",
    });

    const snapshot = agentSession.getMessages()[0];
    assert.deepEqual(snapshot.contextIds, [textEntry!.id, "ctx_item_test"]);

    agentSession.removeContext("ctx_item_test");
    assert.lengthOf(agentSession.getContext(), 1);
    assert.deepEqual(
      agentSession.getMessages()[0].contextIds,
      [textEntry!.id, "ctx_item_test"],
      "history keeps the snapshot after context edits",
    );

    agentSession.clearContext();
    assert.lengthOf(agentSession.getContext(), 0);
    assert.lengthOf(agentSession.getMessages(), 2);

    agentSession.clearMessages();
    assert.lengthOf(agentSession.getMessages(), 0);
  });

  it("deduplicates literature context by item id", function () {
    agentSession.clearContext();
    const fake = {
      id: 42,
      isRegularItem: () => true,
      getField: (name: string) =>
        name === "title" ? "Dedup Paper" : name === "date" ? "2024" : "",
      getCreators: () => [],
    } as any;
    // 绕过 Zotero.Items.get：直接走 addItemContext 的去重逻辑
    const first = agentSession.addItemContext(fake, "文献条目");
    const second = agentSession.addItemContext(fake, "文献条目");
    assert.isOk(first);
    assert.equal(first!.id, second!.id);
    assert.lengthOf(agentSession.getContext(), 1);
  });
});
