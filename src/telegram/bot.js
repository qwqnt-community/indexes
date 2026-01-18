import { Bot } from "grammy";

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
    const specialChars = [ '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!' ];
    return text.replace(new RegExp(`([${specialChars.join('\\')}])`, 'g'), '\\$1');
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
    const { owner, repo, description, releaseInfo, recentCommits = [] } = context;
    let messageText = "";

    if (releaseInfo && releaseInfo.assets && releaseInfo.assets.length > 0) {
        const dateStr = formatDate(releaseInfo.publishedAt, true);
        const versionStr = releaseInfo.tagName ? ` ${releaseInfo.tagName}` : "";
        const fullInfo = versionStr + (dateStr ? ` ${dateStr}` : "");
        const superscriptInfo = fullInfo ? toSuperscript(fullInfo) : "";

        releaseInfo.assets.forEach(asset => {
            const sizeStr = asset.size ? ` \\(__${escapeMarkdown(formatSize(asset.size))}__\\)` : "";
            messageText += `📦 [${escapeMarkdown(asset.name)}](${asset.url})${sizeStr}\n`;
        });
        messageText += `    _${superscriptInfo}_\n`;
        messageText += '──────────────\n';
    }

    const repoPath = `${owner}/${repo}`;
    const repoUrl = `https://github.com/${repoPath}`;
    const starsStr = context.stars ? ` ★${context.stars}` : "";
    messageText += `__*\\# [${escapeMarkdown(repoPath)}](${repoUrl})*__ ${escapeMarkdown(starsStr)}\n`;

    if (description && description.trim()) {
        messageText += `   ${escapeMarkdown(description)}\n`;
    }

    if (recentCommits.length === 0) {
        messageText += ">暂无提交记录";
    } else {
        recentCommits.forEach((commit, index) => {
            const commitMsg = (commit.message || "无描述").trim();
            if (index !== 0) messageText += `\n`;
            messageText += `>• _${escapeMarkdown(commitMsg)}_`;
        });
        messageText += `||\n`;
    }

    return messageText;
}

/**
 * 同步仓库消息（如果存在旧消息则删除，然后发送新消息）
 * @param {number|null} oldMessageId - 旧消息ID
 * @param {object} context - 更新上下文
 * @returns {Promise<number | null>} - 返回新消息ID
 */
export async function syncRepoMessage(oldMessageId, context) {
    const { owner, repo } = context;

    if (oldMessageId && oldMessageId > 0) {
        console.log(`  Deleting old message ${oldMessageId} for ${owner}/${repo}...`);
        await deleteMessage(oldMessageId);
    }

    const messageText = formatRepoMessage(context);
    if (!messageText.trim()) {
        console.error(`Message text is empty for ${owner}/${repo}`);
        return null;
    }

    try {
        console.log(`  Sending message for ${owner}/${repo}...`);
        const otherParams = {
            parse_mode: "MarkdownV2",
            link_preview_options: { is_disabled: true },
        };

        if (TG_GROUP_TOPIC_ID) {
            otherParams.message_thread_id = parseInt(TG_GROUP_TOPIC_ID);
        }

        const { message_id } = await bot.api.sendMessage(TG_GROUP_ID, messageText, otherParams);
        return message_id;
    } catch (error) {
        console.error(`Error sending message for ${owner}/${repo}:`, error.message);
        return null;
    }
}
