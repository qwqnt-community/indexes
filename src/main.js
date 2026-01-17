import {
    getReposByTopic,
    getLatestCommit,
    getRecentCommits,
    getLatestReleaseAsset,
    getRepoInfo
} from "./github/repos.js";
import { getRepoData, getAllTrackedRepos, batchSaveRepoData, clearDataBranch } from "./github/data.js";
import { updateRepoMessage } from "./telegram/bot.js";

const { GITHUB_ORGANIZATION, PLUGIN_TOPIC, FORCE_RESEND } = process.env;
const forceResend = FORCE_RESEND === 'true' || FORCE_RESEND === '1'
if (!GITHUB_ORGANIZATION || !PLUGIN_TOPIC) {
    console.error("missing required environment variables: GITHUB_ORGANIZATION, PLUGIN_TOPIC");
    process.exit(1);
}

/**
 * 主函数
 */
async function main() {
    console.log("Starting repository indexing...");

    try {
        const repos = await getReposByTopic(PLUGIN_TOPIC);
        console.log(`Found ${repos.length} repositories with topic: ${PLUGIN_TOPIC}`);

        const trackedRepos = await getAllTrackedRepos();
        const manuallyTrackedRepos = trackedRepos.filter(
            (repo) => !repos.some(r => r.owner === repo.owner && r.repo === repo.repo)
        );

        console.log(`Processing ${manuallyTrackedRepos.length} manually tracked repositories...`);

        const allRepos = [ ...repos ];
        for (const trackedRepo of manuallyTrackedRepos) {
            const repoInfo = await getRepoInfo(trackedRepo.owner, trackedRepo.repo);
            if (repoInfo) {
                allRepos.push({
                    owner: repoInfo.owner,
                    repo: repoInfo.repo,
                    description: repoInfo.description,
                    default_branch: repoInfo.default_branch || "main",
                });
            }
        }

        const repoDataMap = new Map();
        for (const repo of allRepos) {
            const data = await getRepoData(repo.owner, repo.repo);
            if (data) {
                repoDataMap.set(`${repo.owner}/${repo.repo}`, data);
            }
        }

        await clearDataBranch();

        const updates = [];
        for (const repo of allRepos) {
            console.log(`Processing ${repo.owner}/${repo.repo}...`);

            const latestCommit = await getLatestCommit(repo.owner, repo.repo, repo.default_branch);
            if (!latestCommit) {
                console.log(`  Failed to get latest commit for ${repo.owner}/${repo.repo}`);
                continue;
            }

            const repoData = repoDataMap.get(`${repo.owner}/${repo.repo}`);

            const hasUpdates = !repoData || repoData.commit_id !== latestCommit.sha;

            if (!forceResend && !hasUpdates) {
                console.log(`  No updates for ${repo.owner}/${repo.repo}`);
                updates.push({
                    owner: repo.owner,
                    repo: repo.repo,
                    message_id: repoData.message_id,
                    commit_id: repoData.commit_id,
                });
                continue;
            }

            if (forceResend) {
                console.log(`  Force resending message for ${repo.owner}/${repo.repo}`);
            } else {
                console.log(`  Updates detected for ${repo.owner}/${repo.repo}`);
            }

            const recentCommits = await getRecentCommits(repo.owner, repo.repo, repo.default_branch);
            const releaseAsset = await getLatestReleaseAsset(repo.owner, repo.repo);

            const newMessageId = await updateRepoMessage(
                repoData?.message_id,
                repo,
                releaseAsset?.url,
                releaseAsset?.name || "Release 文件",
                recentCommits
            );

            if (newMessageId) {
                updates.push({
                    owner: repo.owner,
                    repo: repo.repo,
                    message_id: newMessageId,
                    commit_id: latestCommit.sha,
                });
                console.log(`  Updated ${repo.owner}/${repo.repo} successfully`);
            } else {
                console.log(`  Failed to update message for ${repo.owner}/${repo.repo}`);
            }
        }

        await batchSaveRepoData(updates);

        console.log("Repository indexing completed successfully");
    } catch (error) {
        console.error("Error during repository indexing:", error);
        process.exit(1);
    }
}

main().then();
