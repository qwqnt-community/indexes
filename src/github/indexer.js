import { octokit } from "./client.js";
import { GITHUB_ORGANIZATION, PLUGIN_TOPIC } from "../config.js";

/**
 * 获取符合条件的仓库
 * @returns {Promise<Array<{owner: string, repo: string, description: string, default_branch: string, stars: number}>>}
 */
export async function findTargetRepositories() {
    const repos = [];
    const queries = [
        `org:${GITHUB_ORGANIZATION} topic:${PLUGIN_TOPIC}`,
        `topic:${PLUGIN_TOPIC}` // Global search
    ];

    const processedRepos = new Set();

    console.log(`Searching for repositories...`);

    for (const q of queries) {
        let page = 1;
        let hasMore = true;

        console.log(`  Executing query: ${q}`);

        while (hasMore) {
            try {
                const { data } = await octokit.rest.search.repos({
                    q,
                    per_page: 100,
                    page,
                });

                if (data.items.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const item of data.items) {
                    if (item.archived) continue;

                    const repoKey = `${item.owner.login}/${item.name}`;
                    if (processedRepos.has(repoKey)) continue;

                    processedRepos.add(repoKey);
                    repos.push({
                        owner: item.owner.login,
                        repo: item.name,
                        description: item.description || "",
                        default_branch: item.default_branch || "main",
                        stars: item.stargazers_count || 0,
                    });
                }

                if (data.items.length < 100) {
                    hasMore = false;
                } else {
                    page++;
                }

                // Add a small delay for global search to avoid hitting secondary rate limits
                if (q.includes(`topic:${PLUGIN_TOPIC}`) && hasMore) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                console.error(`  Error searching repositories with query "${q}":`, error.message);
                hasMore = false;
            }
        }
    }

    console.log(`Found ${repos.length} unique repositories matching the criteria.`);
    return repos;
}
