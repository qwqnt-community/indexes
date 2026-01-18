import {
    getReposByTopic,
    getLatestCommit,
    getRecentCommits,
    getLatestReleaseInfo,
    getRepoInfo
} from "./github/repos.js";
import { getRepoData, getAllTrackedRepos, batchSaveRepoData, clearDataBranch } from "./github/data.js";
import { syncRepoMessage } from "./telegram/bot.js";

const { GITHUB_ORGANIZATION, PLUGIN_TOPIC, FORCE_RESEND } = process.env;
const forceResend = FORCE_RESEND === 'true' || FORCE_RESEND === '1';

if (!GITHUB_ORGANIZATION || !PLUGIN_TOPIC) {
    console.error("missing required environment variables: GITHUB_ORGANIZATION, PLUGIN_TOPIC");
    process.exit(1);
}

/**
 * 处理单个仓库的更新
 */
async function processRepo(repo, oldData) {
    console.log(`Processing ${repo.owner}/${repo.repo}...`);

    const latestCommit = await getLatestCommit(repo.owner, repo.repo, repo.default_branch);
    if (!latestCommit) {
        console.log(`  Failed to get latest commit for ${repo.owner}/${repo.repo}`);
        return null;
    }

    const hasUpdates = !oldData || oldData.commit_id !== latestCommit.sha;
    if (!forceResend && !hasUpdates) {
        console.log(`  No updates for ${repo.owner}/${repo.repo}`);
        return { ...oldData, owner: repo.owner, repo: repo.repo };
    }

    console.log(forceResend ? `  Force resending...` : `  Updates detected...`);

    const recentCommits = await getRecentCommits(repo.owner, repo.repo, repo.default_branch);
    const releaseInfo = await getLatestReleaseInfo(repo.owner, repo.repo);

    const newMessageId = await syncRepoMessage(oldData?.message_id, {
        ...repo,
        releaseInfo,
        recentCommits,
    });

    if (newMessageId) {
        console.log(`  Updated ${repo.owner}/${repo.repo} successfully`);
        return {
            owner: repo.owner,
            repo: repo.repo,
            message_id: newMessageId,
            commit_id: latestCommit.sha,
        };
    }

    return null;
}

/**
 * 主函数
 */
async function main() {
    console.log("Starting repository indexing...");

    try {
        const repos = await getReposByTopic(PLUGIN_TOPIC);
        const trackedRepos = await getAllTrackedRepos();
        
        // 合并所有需要检查的仓库
        const allRepos = [ ...repos ];
        for (const tracked of trackedRepos) {
            if (!repos.some(r => r.owner === tracked.owner && r.repo === tracked.repo)) {
                const info = await getRepoInfo(tracked.owner, tracked.repo);
                if (info) allRepos.push(info);
            }
        }

        console.log(`Total repositories to check: ${allRepos.length}`);

        // 获取现有数据
        const oldDataMap = new Map();
        for (const repo of allRepos) {
            const data = await getRepoData(repo.owner, repo.repo);
            if (data) oldDataMap.set(`${repo.owner}/${repo.repo}`, data);
        }

        await clearDataBranch();

        const updates = [];
        for (const repo of allRepos) {
            const result = await processRepo(repo, oldDataMap.get(`${repo.owner}/${repo.repo}`));
            if (result) updates.push(result);
        }

        await batchSaveRepoData(updates);
        console.log("Repository indexing completed successfully");
    } catch (error) {
        console.error("Error during repository indexing:", error);
        process.exit(1);
    }
}

main().then();
