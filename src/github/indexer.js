import { octokit } from "./client.js";
import { GITHUB_ORGANIZATION, PLUGIN_TOPIC } from "../config.js";

/**
 * 获取符合条件的仓库
 * @returns {Promise<Array<{owner: string, repo: string, description: string, default_branch: string, stars: number}>>}
 */
export async function findTargetRepositories() {
    const repos = [];
    const queries = [];
    for (const topic of PLUGIN_TOPIC) {
        queries.push(`org:${GITHUB_ORGANIZATION} topic:${topic}`);
        queries.push(`topic:${topic}`); // Global search
    }

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

                    // Allow valid standard naming conventions:
                    // kebab-case: /^[a-z0-9]+(?:-[a-z0-9]+)*$/
                    // snake_case: /^[a-z0-9]+(?:_[a-z0-9]+)*$/
                    // camelCase: /^[a-z]+[a-zA-Z0-9]*$/
                    // PascalCase: /^[A-Z][a-zA-Z0-9]*$/
                    if (item.owner.login !== GITHUB_ORGANIZATION) {
                        const name = item.name;
                        const isKebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
                        const isSnakeCase = /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(name);
                        const isCamelCase = /^[a-z]+[a-zA-Z0-9]*$/.test(name) && !name.includes('_') && !name.includes('-');
                        const isPascalCase = /^[A-Z][a-zA-Z0-9]*$/.test(name) && !name.includes('_') && !name.includes('-');

                        const isValidName = isKebabCase || isSnakeCase || isCamelCase || isPascalCase;

                        // Treat the prefix 'qwqnt-' specially if it exists: 
                        // If it starts with "qwqnt-", the rest must also be a standard convention (e.g., kebab-case or snake_case without extra dashes before capitals)
                        // The above strict regex handles "qwqnt-Anti-Recall" as FALSE because it mixes hyphens with capital letters (not kebab/snake, nor pure camel/pascal)

                        if (!isValidName) {
                            console.log(`  Skipping ${item.owner.login}/${item.name} due to non-standard name`);
                            continue;
                        }
                    }

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
                if (!q.includes('org:') && hasMore) {
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
