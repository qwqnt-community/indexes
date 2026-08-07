import { Bot, InputFile } from "grammy";
import { octokit } from "../github/client.js";

const {
    TG_BOT_TOKEN,
    TG_GROUP_ID,
    TG_GROUP_TOPIC_ID,
} = process.env;

if (!TG_BOT_TOKEN || !TG_GROUP_ID) {
    console.error("missing required environment variables.");
    process.exit(1);
}

export const bot = new Bot(TG_BOT_TOKEN);

/**
 * 转义 MarkdownV2 特殊字符
 * @param {string} text - 需要转义的文本
 * @returns {string} - 转义后的文本
 */
function escapeMarkdown(text) {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * 转义 HTML 特殊字符（用于 Rich Message 的 markdown/html 模式）
 * @param {string} text - 需要转义的文本
 * @returns {string} - 转义后的文本
 */
function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[c]));
}

/**
 * 将 GitHub 风格的 Markdown 转换为 Telegram MarkdownV2
 * - 代码块与行内代码原样保留（双方语法一致，内部不解析实体）
 * - **加粗** / __加粗__ → *加粗*，~~删除线~~ → ~删除线~
 * - [文本](链接) 保留结构，内部特殊字符转义
 * - 其余特殊字符转义，避免 Telegram 解析失败
 */
function convertGithubMarkdown(text) {
    const placeholders = [];
    const protect = (content) => {
        const token = `\u0000${placeholders.length}\u0000`;
        placeholders.push(content);
        return token;
    };

    // 保护代码块与行内代码，内部不做转换与转义
    let result = text.replace(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g, protect);

    // 保护链接：保留结构，转义 label 与 URL 中的特殊字符
    result = result.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) =>
        protect(`[${escapeMarkdown(label)}](${escapeMarkdown(url)})`)
    );

    // GitHub 双星号 / 双下划线加粗 → Telegram 单星号加粗
    result = result.replace(/\*\*([^*\n]+)\*\*/g, (match, t) => protect(`*${escapeMarkdown(t)}*`));
    result = result.replace(/__([^_\n]+)__/g, (match, t) => protect(`*${escapeMarkdown(t)}*`));
    // GitHub 双波浪删除线 → Telegram 单波浪删除线
    result = result.replace(/~~([^~\n]+)~~/g, (match, t) => protect(`~${escapeMarkdown(t)}~`));

    // 其余特殊字符转义
    result = escapeMarkdown(result);

    // 还原被保护的内容
    return result.replace(/\u0000(\d+)\u0000/g, (match, index) => placeholders[Number(index)]);
}

/**
 * 将多行文本转换为可折叠的引用块（Telegram expandable blockquote）
 * 每行以 > 开头，末行追加 || 作为可折叠标记
 */
function toExpandableQuote(text) {
    return text
        .split("\n")
        .map((line, index, lines) => {
            const suffix = index === lines.length - 1 ? "||" : "";
            return `>${line}${suffix}`;
        })
        .join("\n");
}

/**
 * 截断 MarkdownV2 消息，避免超过 Telegram 的消息长度限制
 */
export function truncateMarkdown(text, maxLength) {
    if (text.length <= maxLength) return text;

    let truncated = text.slice(0, maxLength - 3);
    if (truncated.endsWith("\\")) truncated = truncated.slice(0, -1);

    // 截断若切在折叠引用块内（最后一行是引用行但未以 || 闭合），修复块结构
    let lastNewline = truncated.lastIndexOf("\n");
    let lastLine = lastNewline === -1 ? truncated : truncated.slice(lastNewline + 1);
    if (lastLine.startsWith(">")) {
        truncated = truncated.replace(/\s+$/, "");
        lastLine = truncated.slice(lastNewline + 1);
        if (lastLine === ">") {
            // 末尾是空引用行，移除它，避免补出的 || 悬空
            truncated = truncated.slice(0, lastNewline).replace(/\s+$/, "");
            lastNewline = truncated.lastIndexOf("\n");
            lastLine = lastNewline === -1 ? truncated : truncated.slice(lastNewline + 1);
        }
        if (lastLine.startsWith(">") && !lastLine.endsWith("||")) {
            truncated += "||";
        }
    }

    return `${truncated}…`;
}

/**
 * 删除消息
 * @param {number} messageId - 消息ID
 * @returns {Promise<boolean>}
 */
export async function deleteMessage(messageId) {
    try {
        await bot.api.deleteMessage(TG_GROUP_ID, messageId);
        return true;
    } catch (error) {
        console.error(`Error deleting message ${messageId}:`, error.message);
        return false;
    }
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} - 格式化后的字符串
 */
function formatSize(bytes) {
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(unitIndex > 1 ? 1 : 0)}${units[unitIndex]}`;
}

/**
 * 将字符转换为上标形式
 * @param {string} str - 原始字符串
 * @returns {string} - 上标化后的字符串
 */
function toSuperscript(str) {
    const map = {
        '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
        '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
        'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ',
        'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'i': 'ⁱ', 'j': 'ʲ',
        'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'n': 'ⁿ', 'o': 'ᵒ',
        'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ',
        'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
        'A': 'ᴬ', 'B': 'ᴮ', 'D': 'ᴰ', 'E': 'ᴱ', 'G': 'ᴳ',
        'H': 'ᴴ', 'I': 'ᴵ', 'J': 'ᴶ', 'K': 'ᴷ', 'L': 'ᴸ',
        'M': 'ᴹ', 'N': 'ᴺ', 'O': 'ᴼ', 'P': 'ᴾ', 'R': 'ᴿ',
        'T': 'ᵀ', 'U': 'ᵁ', 'V': 'ⱽ', 'W': 'ᵂ',
        '-': '⁻', '.': '·'
    };
    return str.split('').map(c => map[c] || c).join('');
}

/**
 * 格式化时间
 * @param {string} isoString - ISO 时间字符串
 * @param {boolean} onlyDate - 是否只保留日期
 * @returns {string} - 格式化后的时间
 */
function formatDate(isoString, onlyDate = false) {
    if (!isoString) return "";
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    if (onlyDate) return `${year}-${month}-${day}`;
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 格式化仓库更新消息
 * @param {object} context - 更新上下文
 * @returns {string} - 格式化后的 MarkdownV2 文本
 */
export function formatRepoMessage(context) {
    const { owner, repo, description, releaseInfo } = context;
    let messageText = "";

    const repoPath = `${owner}/${repo}`;
    const repoUrl = `https://github.com/${repoPath}`;
    const starsStr = context.stars ? ` ★${context.stars}` : "";
    messageText += `__*\\# [${escapeMarkdown(repoPath)}](${repoUrl})*__ ${escapeMarkdown(starsStr)}\n`;

    if (releaseInfo) {
        const dateStr = formatDate(releaseInfo.publishedAt, true);
        const versionStr = releaseInfo.tagName ? ` ${releaseInfo.tagName}` : "";
        const fullInfo = versionStr + (dateStr ? ` ${dateStr}` : "");
        const superscriptInfo = fullInfo ? toSuperscript(fullInfo) : "";
        if (superscriptInfo) messageText += `  _${escapeMarkdown(superscriptInfo)}_\n`;
    }

    if (description && description.trim()) {
        messageText += `   ${escapeMarkdown(description)}\n`;
    }

    const releaseMessage = releaseInfo?.body?.trim();
    if (releaseMessage) {
        messageText += `\n${toExpandableQuote(convertGithubMarkdown(releaseMessage))}`;
    }

    return messageText;
}

/**
 * 按行截断富文本正文（按 UTF-8 字节计数，Rich Message 限制为 32768 字节）
 * 避免切断行内格式标记；首行超限时按字节安全切分
 * @param {string} body - 正文
 * @param {number} maxBytes - 最大字节数（含追加的省略号后缀）
 * @returns {string} - 截断后的正文
 */
function truncateRichBody(body, maxBytes) {
    if (Buffer.byteLength(body, "utf8") <= maxBytes) return body;

    // 行路径会在末尾追加 "\n…"（4 字节），循环中预留
    const suffixBytes = Buffer.byteLength("\n…", "utf8");
    let truncated = "";
    let size = 0;
    for (const line of body.split("\n")) {
        const lineBytes = Buffer.byteLength(line, "utf8");
        if (size + lineBytes + 1 + suffixBytes > maxBytes) break;
        truncated += line + "\n";
        size += lineBytes + 1;
    }
    truncated = truncated.trimEnd();

    if (truncated) return `${truncated}\n…`;

    // 首行就超过限制：按字节切分（预留省略号 3 字节），并回退被截断的多字节字符
    const buf = Buffer.from(body, "utf8");
    let sliced = buf.subarray(0, maxBytes - 3).toString("utf8");
    while (sliced.endsWith("\uFFFD")) sliced = sliced.slice(0, -1);
    return `${sliced}…`;
}

/**
 * 格式化仓库更新消息（Telegram Rich Message 的 markdown 模式）
 * 标题行加粗、版本号与日期用 <sup> 上标，
 * Release 正文使用 GitHub Flavored Markdown 兼容语法直出，
 * 放入默认折叠（不设 open）的 <details> 块中
 * @param {object} context - 更新上下文
 * @returns {string} - 格式化后的 Rich Markdown 文本
 */
export function formatRichMessage(context) {
    const { owner, repo, description, releaseInfo } = context;

    const repoPath = `${owner}/${repo}`;
    const repoUrl = `https://github.com/${repoPath}`;
    const starsStr = context.stars ? ` ★${context.stars}` : "";

    // 富文本 markdown 中段落内单个换行会渲染为空格，行间用 <br> 强制换行
    let head = `**\\# [${repoPath}](${repoUrl})**${starsStr}<br>\n`;

    if (releaseInfo) {
        const dateStr = formatDate(releaseInfo.publishedAt, true);
        const versionStr = releaseInfo.tagName ? ` ${releaseInfo.tagName}` : "";
        const fullInfo = versionStr + (dateStr ? ` ${dateStr}` : "");
        if (fullInfo.trim()) head += `<sup>${escapeHtml(fullInfo.trim())}</sup><br>\n`;
    }

    if (description && description.trim()) {
        head += `   ${escapeHtml(description)}\n`;
    }

    // 没有 Release 说明时省略折叠块
    const releaseMessage = releaseInfo?.body?.trim();
    if (!releaseMessage) return head.trimEnd();

    // Rich Message 限制：32768 UTF-8 字节（见 @grammyjs/types rich.d.ts）
    const MAX_BYTES = 32768;
    const openTag = "<details><summary>**Release 说明**</summary>\n\n";
    const closeTag = "\n\n</details>";
    const overhead =
        Buffer.byteLength(head, "utf8") +
        Buffer.byteLength(openTag, "utf8") +
        Buffer.byteLength(closeTag, "utf8");
    // 预留省略号后缀（\n… 4 字节）
    const maxBody = MAX_BYTES - overhead - 4;

    const body = truncateRichBody(releaseMessage.replace(/\r\n/g, "\n"), maxBody);
    return `${head}\n${openTag}${body}${closeTag}`;
}

/**
 * 下拉 release 文件为 ArrayBuffer 
 * @param {string} owner 
 * @param {string} repo 
 * @param {number} assetId 
 * @returns {Promise<ArrayBuffer>}
 */
async function downloadAsset(owner, repo, assetId) {
    const { data } = await octokit.rest.repos.getReleaseAsset({
        owner,
        repo,
        asset_id: assetId,
        headers: {
            accept: 'application/octet-stream',
        },
    });
    return data;
}

/**
 * 同步仓库消息（如果存在旧消息则删除，然后发送新消息）
 * @param {number|null} oldMessageId - 旧消息ID
 * @param {object} context - 更新上下文
 * @returns {Promise<number | null>} - 返回新消息ID
 */
/**
 * 发送 release 附件为独立的媒体消息（Rich Message 媒体不支持 document）
 * @param {string} owner - 仓库所有者
 * @param {string} repo - 仓库名
 * @param {Array} assets - 附件列表
 * @param {object} otherParams - 公共发送参数
 * @returns {Promise<number[]>} 返回所有媒体消息 ID，失败返回空数组
 */
async function sendReleaseAssets(owner, repo, assets, otherParams) {
    const mediaGroup = [];

    for (const asset of assets) {
        console.log(`  Downloading asset ${asset.name} for ${owner}/${repo}...`);
        try {
            const ab = await downloadAsset(owner, repo, asset.id);
            const file = new InputFile(new Uint8Array(ab), asset.name);
            mediaGroup.push({
                type: "document",
                media: file,
            });
        } catch (assetErr) {
            console.error(`  Failed to download asset ${asset.name}: ${assetErr.message}. Skipping...`);
        }
    }

    if (mediaGroup.length === 0) return [];

    try {
        if (mediaGroup.length === 1) {
            const { message_id } = await bot.api.sendDocument(TG_GROUP_ID, mediaGroup[0].media, { ...otherParams });
            return [message_id];
        }

        const groupParams = {};
        if (TG_GROUP_TOPIC_ID) {
            groupParams.message_thread_id = parseInt(TG_GROUP_TOPIC_ID);
        }

        const itemsToSend = mediaGroup.slice(0, 10);

        const messages = await bot.api.sendMediaGroup(TG_GROUP_ID, itemsToSend, groupParams);
        return messages.map((message) => message.message_id);
    } catch (error) {
        console.error(`  Failed to send release assets for ${owner}/${repo}:`, error.message);
        return [];
    }
}

/**
 * 同步仓库消息（如果存在旧消息则删除，然后发送新消息）
 * 正文优先使用 Rich Message（Release 正文放默认折叠的 details 块），
 * 失败时回退 MarkdownV2；附件作为独立媒体消息发送
 * @param {number|null} oldMessageId - 旧正文消息ID
 * @param {object} context - 更新上下文
 * @param {number[]} oldMediaMessageIds - 旧附件消息ID列表
 * @returns {Promise<{message_id: number, media_message_ids: number[]} | null>}
 */
export async function syncRepoMessage(oldMessageId, context, oldMediaMessageIds = []) {
    const { owner, repo, releaseInfo } = context;

    if (oldMessageId && oldMessageId > 0) {
        console.log(`  Deleting old message ${oldMessageId} for ${owner}/${repo}...`);
        await deleteMessage(oldMessageId);
    }
    for (const mediaMessageId of oldMediaMessageIds) {
        console.log(`  Deleting old media message ${mediaMessageId} for ${owner}/${repo}...`);
        await deleteMessage(mediaMessageId);
    }

    // Rich Message（主路径）与 MarkdownV2（回退）两种格式
    const richText = formatRichMessage(context);
    const fallbackText = truncateMarkdown(formatRepoMessage(context), 4096);
    if (!fallbackText.trim()) {
        console.error(`Message text is empty for ${owner}/${repo}`);
        return null;
    }

    console.log(`  Sending message for ${owner}/${repo}...`);
    const otherParams = {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
    };
    if (TG_GROUP_TOPIC_ID) {
        otherParams.message_thread_id = parseInt(TG_GROUP_TOPIC_ID);
    }

    // 附件作为独立媒体消息先发送（Rich Message 媒体不支持 document）
    const hasAssets = releaseInfo?.assets?.length > 0;
    const mediaMessageIds = hasAssets
        ? await sendReleaseAssets(owner, repo, releaseInfo.assets, otherParams)
        : [];

    // 主路径：Rich Message
    let messageId = null;
    try {
        const richParams = {};
        if (TG_GROUP_TOPIC_ID) {
            richParams.message_thread_id = parseInt(TG_GROUP_TOPIC_ID);
        }
        const { message_id } = await bot.api.sendRichMessage(
            TG_GROUP_ID,
            { markdown: richText },
            richParams,
        );
        messageId = message_id;
    } catch (richErr) {
        console.error(`  Failed to send Rich Message for ${owner}/${repo}:`, richErr.message);
    }

    // 回退：MarkdownV2 文本
    if (!messageId) {
        try {
            console.log(`  Falling back to sending MarkdownV2 text message for ${owner}/${repo}...`);
            const { message_id } = await bot.api.sendMessage(TG_GROUP_ID, fallbackText, otherParams);
            messageId = message_id;
        } catch (error) {
            console.error(`Error sending message for ${owner}/${repo}:`, error.message);
            // 正文彻底失败：清理刚发送的附件，避免留下孤儿消息
            for (const mediaMessageId of mediaMessageIds) {
                await deleteMessage(mediaMessageId);
            }
            return null;
        }
    }

    return { message_id: messageId, media_message_ids: mediaMessageIds };
}
