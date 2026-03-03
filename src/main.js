import {
    getLatestCommit,
    getRecentCommits,
    getLatestReleaseInfo,
    getRepoInfo,
    createPullRequestForNewRepo,
    cleanupMergedPrBranches
} from "./github/repos.js";
import { getRepoData, getAllTrackedRepos, batchSaveRepoData } from "./github/data.js";
import { syncRepoMessage } from "./telegram/bot.js";
import { findTargetRepositories } from "./github/indexer.js";
import { GITHUB_ORGANIZATION } from "./config.js";

const { FORCE_RESEND } = process.env;
const forceResend = FORCE_RESEND === 'true' || FORCE_RESEND === '1';

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
        const repos = await findTargetRepositories();
        const trackedRepos = await getAllTrackedRepos();

        // 区分应该直接处理的仓库和需要提 PR 的仓库
        const readyToProcessRepos = [];
        const externalNewRepos = [];

        for (const repo of repos) {
            const isTracked = trackedRepos.some(r => r.owner === repo.owner && r.repo === repo.repo);
            const isInternal = repo.owner === GITHUB_ORGANIZATION;

            if (isTracked || isInternal) {
                readyToProcessRepos.push(repo);
            } else {
                externalNewRepos.push(repo);
            }
        }

        // 确保追踪列表中的仓库即使本次未匹配到（可能 token/rate limt 原因），也要加入处理列表
        const trackedMap = new Map();
        for (const tr of trackedRepos) trackedMap.set(`${tr.owner}/${tr.repo}`, tr);

        for (const rp of readyToProcessRepos) {
            trackedMap.delete(`${rp.owner}/${rp.repo}`);
        }

        // 抓取剩余 tracked 的详细信息，以防止漏掉
        for (const [key, tr] of trackedMap.entries()) {
            const info = await getRepoInfo(tr.owner, tr.repo);
            if (info) readyToProcessRepos.push(info);
        }

        console.log(`Total repositories to check: ${readyToProcessRepos.length}`);
        if (externalNewRepos.length > 0) {
            console.log(`Discovered ${externalNewRepos.length} external untracked repositories. Will create PRs for them.`);
        }

        // 清理已合并的 PR 分支
        console.log("Cleaning up merged PR branches...");
        await cleanupMergedPrBranches(trackedRepos);

        // 处理并创建 PR
        for (const newRepo of externalNewRepos) {
            await createPullRequestForNewRepo(newRepo.owner, newRepo.repo);
        }

        // 获取现有数据
        const oldDataMap = new Map();
        for (const repo of readyToProcessRepos) {
            const data = await getRepoData(repo.owner, repo.repo);
            if (data) oldDataMap.set(`${repo.owner}/${repo.repo}`, data);
        }

        const allUpdates = [];
        for (const repo of readyToProcessRepos) {
            const oldData = oldDataMap.get(`${repo.owner}/${repo.repo}`);

            // 如果仓库归档了，停止追踪它
            if (repo.archived) {
                console.log(`Repository ${repo.owner}/${repo.repo} is archived. Checking for existing tracked data to remove...`);
                // 如果之前追踪过，尝试删掉旧消息并抛弃该仓库
                if (oldData && oldData.message_id) {
                    const { deleteMessage } = await import("./telegram/bot.js");
                    console.log(`  Deleting archive repo pinned message ${oldData.message_id}...`);
                    await deleteMessage(oldData.message_id);
                }
                continue; // 抛弃，不放入 allUpdates，下次就不会被算作 tracked
            }

            const result = await processRepo(repo, oldData);
            if (result) allUpdates.push(result);
        }

        await batchSaveRepoData(allUpdates);
        console.log("Repository indexing completed successfully");
    } catch (error) {
        console.error("Error during repository indexing:", error);
        process.exit(1);
    }
}

main().then();
