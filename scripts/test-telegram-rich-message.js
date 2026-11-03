import assert from "node:assert/strict";
import { Api } from "grammy";

// 会真实发送消息。运行前设置 TG_BOT_TOKEN 和 TG_GROUP_ID；可选 TG_GROUP_TOPIC_ID。
// 仅用内存测试附件替代 GitHub 下载，不访问或修改 GitHub 数据。
if (!process.env.TG_BOT_TOKEN || !process.env.TG_GROUP_ID) {
    throw new Error("请设置 TG_BOT_TOKEN 和 TG_GROUP_ID 后运行实测脚本");
}
process.env.CUSTOM_GITHUB_TOKEN ||= "test-fixture-only";

const { bot, syncRepoMessage } = await import("../src/telegram/bot.js");
const { octokit } = await import("../src/github/client.js");
// Node 原生 fetch 可使用 NODE_USE_ENV_PROXY=1 配合 HTTPS_PROXY；
// 仍由 grammY 构建 multipart，生产代码的 API 客户端保持原样。
bot.api = new Api(process.env.TG_BOT_TOKEN, {
    timeoutSeconds: 30,
    fetch: async (url, options) => {
        // grammY 使用的 AbortSignal polyfill 不能直接交给 Node fetch。
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (options.signal.aborted) abort();
        else options.signal.addEventListener("abort", abort);
        try {
            return await fetch(url, { ...options, signal: controller.signal, duplex: "half" });
        } finally {
            options.signal.removeEventListener("abort", abort);
        }
    },
});
const identity = await bot.api.getMe();
console.log(JSON.stringify({ bot_id: identity.id, username: identity.username }));
const fixtures = [
    { name: "rich-message-test.txt", content: "Telegram 富文本内嵌附件测试\n正文与文件位于同一条消息。\n" },
    { name: "release-example.json", content: JSON.stringify({ test: true, feature: "rich-message-document", version: "1.0.0" }, null, 2) },
];
octokit.rest.repos.getReleaseAsset = async ({ asset_id }) => ({
    data: new TextEncoder().encode(fixtures[asset_id].content).buffer,
});

let sentMessage;
const methods = [];
bot.api.config.use(async (previous, method, payload, signal) => {
    methods.push(method);
    const response = await previous(method, payload, signal);
    if (method === "sendRichMessage" && response.ok) sentMessage = response.result;
    return response;
});

const result = await syncRepoMessage(null, {
    owner: "qwqnt-community",
    repo: "indexes",
    description: "富文本内嵌附件实测：下方文件应与说明处于同一条消息。",
    releaseInfo: {
        tagName: "rich-document-test",
        publishedAt: new Date().toISOString(),
        body: "## 内嵌附件测试\n\n**这是一条测试消息。**\n\nRelease 说明默认折叠，文件显示在折叠块之后，可直接下载。",
        assets: fixtures.map(({ name }, id) => ({ id, name })),
    },
});

// 发送完成立即输出回执；后续校验失败时也可据此定位，避免盲目重发。
console.log(JSON.stringify({ chat_id: process.env.TG_GROUP_ID, ...result, methods }));
assert.ok(sentMessage?.rich_message, "未收到富文本消息回执，请检查前面的发送日志，不要盲目重发");
assert.deepEqual(result.media_message_ids, []);
assert.deepEqual(methods, ["sendRichMessage"]);
assert.equal(String(sentMessage.chat.id), process.env.TG_GROUP_ID);

const documents = [];
function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.type === "document" && value.document) documents.push(value.document);
    for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child === "object") visit(child);
    }
}
visit(sentMessage.rich_message);
assert.equal(documents.length, fixtures.length, "回执中的文件块数量不符");
for (const [index, document] of documents.entries()) {
    const expected = fixtures[index];
    assert.equal(document.file_name, expected.name);
    assert.equal(document.file_size, Buffer.byteLength(expected.content));
    const file = await bot.api.getFile(document.file_id);
    const response = await fetch(`https://api.telegram.org/file/bot${process.env.TG_BOT_TOKEN}/${file.file_path}`);
    assert.ok(response.ok, "测试附件下载失败");
    assert.equal(await response.text(), expected.content, "下载内容与上传内容不一致");
}
console.log(JSON.stringify({ verified: true, message_id: sentMessage.message_id, files: documents.map(({ file_name, file_size }) => ({ file_name, file_size })) }));
