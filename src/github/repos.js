import { octokit } from "./client.js";

const { GITHUB_REPOSITORY } = process.env;
let prOwner = "";
let prRepo = "";
if (GITHUB_REPOSITORY) {
    [prOwner, prRepo] = GITHUB_REPOSITORY.split("/");
}

/**
 * 为第三方仓库创建 Pull Request 以添加到追踪列表
 * @param {string} newOwner 
 * @param {string} newRepo 
 */
export async function createPullRequestForNewRepo(newOwner, newRepo) {
    if (!prOwner || !prRepo) {
        console.error("GITHUB_REPOSITORY not set, cannot create PR");
        return false;
    }

    const branchName = `indexing/${newOwner}/${newRepo}`;
    const filePath = `repos/${newOwner}/${newRepo}.json`;
    const emptyState = JSON.stringify({ message_id: 0, commit_id: "" }, null, 2);

    try {
        console.log(`Creating/Updating PR for external repository: ${newOwner}/${newRepo}...`);

        // 1. Get default branch sha (main)
        const { data: repoData } = await octokit.rest.repos.get({ owner: prOwner, repo: prRepo });
        const defaultBranch = repoData.default_branch;

        // Fetch the CURRENT `data` branch commit sha and tree
        const { data: dataRef } = await octokit.rest.git.getRef({
            owner: prOwner,
            repo: prRepo,
            ref: `heads/data`
        });
        const dataBaseSha = dataRef.object.sha;

        const { data: dataCommit } = await octokit.rest.git.getCommit({
            owner: prOwner,
            repo: prRepo,
            commit_sha: dataBaseSha
        });
        const dataTreeSha = dataCommit.tree.sha;

        // 2. Check if a PR branch already exists
        let branchExists = false;
        try {
            await octokit.rest.git.getRef({
                owner: prOwner,
                repo: prRepo,
                ref: `heads/${branchName}`
            });
            branchExists = true;
        } catch (error) {
            if (error.status !== 404) throw error;
        }

        // 3. Create a new Tree based on the LATEST `data` branch tree, and add our new repo JSON
        const { data: newTree } = await octokit.rest.git.createTree({
            owner: prOwner,
            repo: prRepo,
            base_tree: dataTreeSha,
            tree: [
                {
                    path: filePath,
                    mode: '100644',
                    type: 'blob',
                    content: emptyState
                }
            ]
        });

        // 4. Create a new commit pointing to the new tree, parented by the CURRENT `data` branch
        const { data: newCommit } = await octokit.rest.git.createCommit({
            owner: prOwner,
            repo: prRepo,
            message: `Add new repository ${newOwner}/${newRepo}`,
            tree: newTree.sha,
            parents: [dataBaseSha]
        });

        // 5. Update or Create the PR Branch Ref
        if (branchExists) {
            console.log(`  Branch ${branchName} already exists. Force updating to sync with latest 'data' branch to resolve potential conflicts...`);
            await octokit.rest.git.updateRef({
                owner: prOwner,
                repo: prRepo,
                ref: `heads/${branchName}`,
                sha: newCommit.sha,
                force: true
            });

            // Branch has been updated to avoid conflicts. Do not open another PR to prevent duplicate errors.
            return true;
        } else {
            console.log(`  Creating new branch ${branchName}...`);
            await octokit.rest.git.createRef({
                owner: prOwner,
                repo: prRepo,
                ref: `refs/heads/${branchName}`,
                sha: newCommit.sha
            });
        }

        // 6. Create Pull Request
        const { data: prData } = await octokit.rest.pulls.create({
            owner: prOwner,
            repo: prRepo,
            title: `Add new repository ${newOwner}/${newRepo}`,
            head: branchName,
            base: 'data',
            body: `Automatically discovered third-party repository [${newOwner}/${newRepo}](https://github.com/${newOwner}/${newRepo}) with the target plugin topic.\n\nMerge this PR to start tracking it.`
        });

        // 7. Add label
        await octokit.rest.issues.addLabels({
            owner: prOwner,
            repo: prRepo,
            issue_number: prData.number,
            labels: ["bot:indexing"]
        });

        console.log(`  Pull Request created successfully: ${prData.html_url} with label bot:indexing`);
        return true;
    } catch (error) {
        if (error.message && error.message.includes("A pull request already exists")) {
            console.log(`  Pull request already exists for ${newOwner}/${newRepo}.`);
            return true;
        }
        console.error(`Error creating/updating PR for ${newOwner}/${newRepo}:`, error.message);
        return false;
    }
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
            body: data.body,
            assets: (data.assets || []).map(asset => ({
                id: asset.id, // Needed for downloading via API
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
            archived: data.archived || false,
        };
    } catch (error) {
        console.error(`Error fetching repo info for ${owner}/${repo}:`, error.message);
        return null;
    }
}
