import { octokit } from "./client.js";

const { GITHUB_ORGANIZATION } = process.env;
if (!GITHUB_ORGANIZATION) {
    console.error("missing GITHUB_ORGANIZATION environment variable.");
    process.exit(1);
}

/**
 * 获取组织中带有特定 topic 的所有仓库
 * @param {string} topic - 仓库名称
 * @returns {Promise<Array<{owner: string, repo: string, description: string, default_branch: string}>>}
 */
export async function getReposByTopic(topic) {
    const repos = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const { data } = await octokit.rest.search.repos({
            q: `org:${GITHUB_ORGANIZATION} topic:${topic}`,
            per_page: 100,
            page,
        });

        if (data.items.length === 0) {
            hasMore = false;
            break;
        }

        for (const item of data.items) {
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
    }

    return repos;
}

/**
 * 获取仓库的最新提交
 * @param {string} owner - 仓库所有者
 * @param {string} repo - 仓库名称
 * @param {string} branch - 分支名称
 * @returns {Promise<{sha: string, message: string} | null>}
 */
export async function getLatestCommit(owner, repo, branch = "main") {
    try {
        const { data } = await octokit.rest.repos.listCommits({
            owner,
            repo,
            sha: branch,
            per_page: 1,
        });

        if (data.length === 0) {
            return null;
        }

        return {
            sha: data[0].sha,
            message: data[0].commit.message,
        };
    } catch (error) {
        console.error(`Error fetching latest commit for ${owner}/${repo}:`, error.message);
        return null;
    }
}

/**
 * 获取仓库的最近六条提交
 * @param {string} owner - 仓库所有者
 * @param {string} repo - 仓库名称
 * @param {string} branch - 分支名称
 * @returns {Promise<Array<{sha: string, message: string, date: string}>>}
 */
export async function getRecentCommits(owner, repo, branch = "main") {
    try {
        const { data } = await octokit.rest.repos.listCommits({
            owner,
            repo,
            sha: branch,
            per_page: 6,
        });

        return data.map((commit) => ({
            sha: commit.sha,
            message: commit.commit.message.split("\n")[0],
            date: commit.commit.author.date,
        }));
    } catch (error) {
        console.error(`Error fetching recent commits for ${owner}/${repo}:`, error.message);
        return [];
    }
}

/**
 * 获取仓库的最新 release 信息及文件列表
 * @param {string} owner - 仓库所有者
 * @param {string} repo - 仓库名称
 * @returns {Promise<{tagName: string, publishedAt: string, assets: Array<{url: string, name: string}>} | null>}
 */
export async function getLatestReleaseInfo(owner, repo) {
    try {
        const { data } = await octokit.rest.repos.getLatestRelease({
            owner,
            repo,
        });

        return {
            tagName: data.tag_name,
            publishedAt: data.published_at,
            assets: (data.assets || []).map(asset => ({
                url: asset.browser_download_url,
                name: asset.name,
                size: asset.size
            }))
        };
    } catch (error) {
        if (error.status === 404) return null;
        console.error(`Error fetching release for ${owner}/${repo}:`, error.message);
        return null;
    }
}

/**
 * 获取仓库信息
 * @param {string} owner - 仓库所有者
 * @param {string} repo - 仓库名称
 * @returns {Promise<{owner: string, repo: string, description: string, default_branch: string} | null>}
 */
export async function getRepoInfo(owner, repo) {
    try {
        const { data } = await octokit.rest.repos.get({
            owner,
            repo,
        });

        return {
            owner: data.owner.login,
            repo: data.name,
            description: data.description || "",
            default_branch: data.default_branch || "main",
            stars: data.stargazers_count || 0,
        };
    } catch (error) {
        console.error(`Error fetching repo info for ${owner}/${repo}:`, error.message);
        return null;
    }
}
