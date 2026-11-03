import assert from "node:assert/strict";
import { test } from "node:test";

// 使用假凭据与 API 替身，测试不会连接 Telegram 或 GitHub。
process.env.TG_BOT_TOKEN = "123456:test";
process.env.TG_GROUP_ID = "788335272";
process.env.TG_GROUP_TOPIC_ID = "42";
process.env.CUSTOM_GITHUB_TOKEN = "test";

const { bot, formatRichMessage, syncRepoMessage } = await import("../src/telegram/bot.js");
const { octokit } = await import("../src/github/client.js");
let respond;
bot.api.config.use((_previous, method, payload) => respond(method, payload));

function fixture(count = 2) {
    return {
        owner: "example",
        repo: "plugin",
        description: "附件测试",
        releaseInfo: {
            tagName: "v1.0.0",
            body: "## 更新\n\n支持富文本附件。",
            assets: Array.from({ length: count }, (_, id) => ({ id, name: `asset-${id}.txt` })),
        },
    };
}

function prepare(handler = () => undefined) {
    const calls = [];
    const downloads = [];
    octokit.rest.repos.getReleaseAsset = async ({ asset_id }) => {
        downloads.push(asset_id);
        const bytes = new TextEncoder().encode(`file ${asset_id}`);
        return { data: bytes.buffer };
    };
    respond = async (method, payload) => {
        calls.push({ method, payload });
        const override = await handler(method, payload);
        if (override) return override;
        return {
            ok: true,
            result: method === "sendMediaGroup"
                ? payload.media.map((_, index) => ({ message_id: 200 + index }))
                : method === "deleteMessage" ? true : { message_id: 100 + calls.length },
        };
    };
    return { calls, downloads };
}

const rejected = () => ({ ok: false, error_code: 400, description: "test rejection" });

test("富文本一次发送全部文件，清理旧正文和独立附件", async () => {
    const { calls, downloads } = prepare();
    const result = await syncRepoMessage(11, fixture(), [12, 13]);
    assert.deepEqual(calls.map(({ method }) => method), [
        "deleteMessage", "deleteMessage", "deleteMessage", "sendRichMessage",
    ]);
    assert.deepEqual(calls.slice(0, 3).map(({ payload }) => payload.message_id), [11, 12, 13]);
    assert.deepEqual(downloads, [0, 1]);
    const { rich_message: rich, message_thread_id: topic } = calls.at(-1).payload;
    assert.equal(topic, 42);
    assert.ok(rich.markdown.indexOf("</details>") < rich.markdown.indexOf("<tg-document"));
    assert.equal(rich.media.length, 2);
    for (const [index, { id, media }] of rich.media.entries()) {
        assert.ok(rich.markdown.includes(`tg://document?id=${id}`));
        assert.equal(media.type, "document");
        assert.equal(media.media.filename, `asset-${index}.txt`);
        assert.equal(new TextDecoder().decode(await media.media.toRaw()), `file ${index}`);
    }
    assert.deepEqual(result, { message_id: 104, media_message_ids: [] });
});

test("无正文仍显示文件；长中文正文为文件引用预留字节", () => {
    const context = fixture();
    context.releaseInfo.body = "";
    const withoutBody = formatRichMessage(context, ["release_asset_0"]);
    assert.ok(withoutBody.includes("<tg-document"));
    assert.ok(!withoutBody.includes("<details>"));
    context.releaseInfo.body = "中文更新说明\n".repeat(5000);
    const long = formatRichMessage(context, ["release_asset_0", "release_asset_1"]);
    assert.ok(Buffer.byteLength(long, "utf8") <= 32768);
    assert.ok(long.includes("</details>"));
    assert.ok(long.endsWith('<tg-document src="tg://document?id=release_asset_1"></tg-document>'));
    assert.ok(!long.includes("\uFFFD"));
});

test("无附件消息不带 media；下载失败不生成悬空引用", async () => {
    let state = prepare();
    await syncRepoMessage(null, fixture(0));
    assert.equal(state.calls.length, 1);
    assert.ok(!("media" in state.calls[0].payload.rich_message));
    state = prepare();
    const download = octokit.rest.repos.getReleaseAsset;
    octokit.rest.repos.getReleaseAsset = async (params) => {
        if (params.asset_id === 0) throw new Error("test download failure");
        return download(params);
    };
    await syncRepoMessage(null, fixture());
    const rich = state.calls[0].payload.rich_message;
    assert.equal(rich.media.length, 1);
    assert.equal(rich.media[0].media.media.filename, "asset-1.txt");
    assert.equal((rich.markdown.match(/<tg-document /g) || []).length, 1);
});

test("富文本失败后复用下载并分批发送所有附件", async () => {
    const { calls, downloads } = prepare((method) => method === "sendRichMessage" ? rejected() : undefined);
    const result = await syncRepoMessage(null, fixture(11));
    assert.deepEqual(calls.map(({ method }) => method), [
        "sendRichMessage", "sendMediaGroup", "sendDocument", "sendMessage",
    ]);
    assert.equal(downloads.length, 11);
    assert.equal(calls[1].payload.media.length, 10);
    assert.equal(calls[1].payload.message_thread_id, 42);
    assert.equal(calls[2].payload.document.filename, "asset-10.txt");
    assert.equal(result.media_message_ids.length, 11);
});

test("回退正文失败时清理刚发送的附件", async () => {
    const { calls } = prepare((method) => ["sendRichMessage", "sendMessage"].includes(method) ? rejected() : undefined);
    const result = await syncRepoMessage(null, fixture(1));
    assert.equal(result, null);
    assert.deepEqual(calls.map(({ method }) => method), [
        "sendRichMessage", "sendDocument", "sendMessage", "deleteMessage",
    ]);
    assert.equal(calls.at(-1).payload.message_id, 102);
});
