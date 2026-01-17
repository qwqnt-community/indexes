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
 * 发送仓库更新消息
 * @param {object} repoInfo - 仓库信息
 * @param {string} repoInfo.owner - 仓库所有者
 * @param {string} repoInfo.repo - 仓库名称
 * @param {string} repoInfo.description - 仓库描述
 * @param {string} releaseUrl - Release 文件下载链接
 * @param {string} releaseFileName - Release 文件名
 * @param {Array<{sha: string, message: string}>} recentCommits - 最近三条提交
 * @returns {Promise<number | null>} - 返回消息ID
 */
export async function sendRepoUpdateMessage(repoInfo, releaseUrl, releaseFileName, recentCommits) {
    try {
        let messageText = "";

        if (releaseUrl) {
            messageText += `📦 [${escapeMarkdown(releaseFileName)}](${releaseUrl})\n\n`;
        }

        const repoPath = `${repoInfo.owner}/${repoInfo.repo}`;
        const repoUrl = `https://github.com/${repoPath}`;
        messageText += `__*\\# [${escapeMarkdown(repoPath)}](${repoUrl})*__\n`;

        if (repoInfo.description && repoInfo.description.trim()) {
            messageText += `${escapeMarkdown(repoInfo.description)}\n`;
        }

        if (recentCommits.length === 0) {
            messageText += ">暂无提交记录";
        } else {
            recentCommits.forEach((commit, index) => {
                const commitMsg = commit.message.trim() || "无描述";
                if (index !== 0) messageText += `\n`;
                messageText += `>• _${escapeMarkdown(commitMsg)}_`;
            });
            messageText += `||\n`;
        }

        if (!messageText.trim()) {
            console.error(`Message text is empty for ${repoInfo.owner}/${repoInfo.repo}`);
            return null;
        }

        console.log(`  Sending message for ${repoInfo.owner}/${repoInfo.repo}:`);
        console.log(`  ${messageText.replace(/\n/g, '\\n')}`);

        const otherParams = {
            parse_mode: "MarkdownV2",
            link_preview_options: {
                is_disabled: true,
            },
        };

        if (TG_GROUP_TOPIC_ID) {
            otherParams.message_thread_id = parseInt(TG_GROUP_TOPIC_ID);
        }

        const { message_id } = await bot.api.sendMessage(TG_GROUP_ID, messageText, otherParams);
        return message_id;
    } catch (error) {
        console.error(`Error sending message for ${repoInfo.owner}/${repoInfo.repo}:`, error.message);
        return null;
    }
}

/**
 * 更新仓库消息（删除旧消息，发送新消息）
 * @param {number} oldMessageId - 旧消息ID
 * @param {object} repoInfo - 仓库信息
 * @param {string} releaseUrl - Release 文件下载链接
 * @param {string} releaseFileName - Release 文件名
 * @param {Array<{sha: string, message: string}>} recentCommits - 最近三条提交
 * @returns {Promise<number | null>} - 返回新消息ID
 */
export async function updateRepoMessage(oldMessageId, repoInfo, releaseUrl, releaseFileName, recentCommits) {
    if (oldMessageId && oldMessageId > 0) {
        console.log(`  Deleting old message ${oldMessageId} for ${repoInfo.owner}/${repoInfo.repo}...`);
        const deleted = await deleteMessage(oldMessageId);
        if (deleted) {
            console.log(`  Old message deleted successfully`);
        } else {
            console.log(`  Failed to delete old message, continuing...`);
        }
    } else {
        console.log(`  No old message to delete (messageId: ${oldMessageId})`);
    }

    return await sendRepoUpdateMessage(repoInfo, releaseUrl, releaseFileName, recentCommits);
}
