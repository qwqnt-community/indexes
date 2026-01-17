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
 * @returns {Promise<Array<{sha: string, message: string}>>}
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
        }));
    } catch (error) {
        console.error(`Error fetching recent commits for ${owner}/${repo}:`, error.message);
        return [];
    }
}

/**
 * 获取仓库的最新 release 文件
 * @param {string} owner - 仓库所有者
 * @param {string} repo - 仓库名称
 * @returns {Promise<{url: string, name: string} | null>} - 返回下载链接和文件名
 */
export async function getLatestReleaseAsset(owner, repo) {
    try {
        const { data } = await octokit.rest.repos.getLatestRelease({
            owner,
            repo,
        });

        if (!data.assets || data.assets.length === 0) {
            return null;
        }

        const qwqntAsset = data.assets.find(
            (asset) => asset.name.match(/^qwqnt-.*\.zip$/)
        );

        return qwqntAsset ? {
            url: qwqntAsset.browser_download_url,
            name: qwqntAsset.name
        } : null;
    } catch (error) {
        if (error.status === 404) {
            return null;
        }
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
        };
    } catch (error) {
        console.error(`Error fetching repo info for ${owner}/${repo}:`, error.message);
        return null;
    }
}
