import { octokit } from "./client.js";

const { GITHUB_REPOSITORY } = process.env;
if (!GITHUB_REPOSITORY) {
    console.error("missing GITHUB_REPOSITORY environment variable.");
    process.exit(1);
}

const [ owner, repo ] = GITHUB_REPOSITORY.split("/");
const DATA_BRANCH = "data";
const DATA_PATH_PREFIX = "repos";

/**
 * 执行 Git 命令
 * @param {string} command - Git 命令
 * @returns {Promise<string>}
 */
async function execGit(command) {
    const { exec } = await import("child_process");
    return new Promise((resolve, reject) => {
        exec(command, { encoding: "utf-8" }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

/**
 * 获取仓库数据
 * @param {string} repoOwner - 仓库所有者
 * @param {string} repoName - 仓库名称
 * @returns {Promise<{message_id: number, commit_id: string} | null>}
 */
export async function getRepoData(repoOwner, repoName) {
    try {
        const path = `${DATA_PATH_PREFIX}/${repoOwner}/${repoName}.json`;
        const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref: DATA_BRANCH,
        });

        if (Array.isArray(data)) {
            return null;
        }

        const content = Buffer.from(data.content, "base64").toString("utf-8");
        return JSON.parse(content);
    } catch (error) {
        if (error.status === 404) {
            return null;
        }
        throw error;
    }
}

/**
 * 保存仓库数据
 * @param {string} repoOwner - 仓库所有者
 * @param {string} repoName - 仓库名称
 * @param {object} data - 数据对象
 * @param {number} data.message_id - 消息ID
 * @param {string} data.commit_id - 提交ID
 */
export async function saveRepoData(repoOwner, repoName, { message_id, commit_id }) {
    const path = `${DATA_PATH_PREFIX}/${repoOwner}/${repoName}.json`;
    const content = JSON.stringify({ message_id, commit_id }, null, 2);
    const contentBase64 = Buffer.from(content).toString("base64");

    try {
        const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref: DATA_BRANCH,
        });

        if (Array.isArray(data)) {
            return;
        }

        await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path,
            message: `Update repo data: ${repoOwner}/${repoName}`,
            content: contentBase64,
            sha: data.sha,
            branch: DATA_BRANCH,
        });
    } catch (error) {
        if (error.status === 404) {
            try {
                await octokit.rest.repos.createOrUpdateFileContents({
                    owner,
                    repo,
                    path,
                    message: `Update repo data: ${repoOwner}/${repoName}`,
                    content: contentBase64,
                    branch: DATA_BRANCH,
                });
            } catch (createError) {
                if (createError.status === 404 && createError.message.includes("does not exist")) {
                    await octokit.rest.repos.createOrUpdateFileContents({
                        owner,
                        repo,
                        path: `${DATA_PATH_PREFIX}/.gitkeep`,
                        message: `Initialize repos directory`,
                        content: Buffer.from("# Repository Data").toString("base64"),
                        branch: DATA_BRANCH,
                    });
                    await octokit.rest.repos.createOrUpdateFileContents({
                        owner,
                        repo,
                        path,
                        message: `Update repo data: ${repoOwner}/${repoName}`,
                        content: contentBase64,
                        branch: DATA_BRANCH,
                    });
                } else {
                    throw createError;
                }
            }
            return;
        }
        throw error;
    }
}

/**
 * 删除仓库数据
 * @param {string} repoOwner - 仓库所有者
 * @param {string} repoName - 仓库名称
 */
export async function deleteRepoData(repoOwner, repoName) {
    const path = `${DATA_PATH_PREFIX}/${repoOwner}/${repoName}.json`;

    try {
        const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref: DATA_BRANCH,
        });

        if (Array.isArray(data)) {
            return;
        }

        await octokit.rest.repos.deleteFile({
            owner,
            repo,
            path,
            message: `Delete repo data: ${repoOwner}/${repoName}`,
            sha: data.sha,
            branch: DATA_BRANCH,
        });
    } catch (error) {
        if (error.status === 404) {
            return;
        }
        throw error;
    }
}

/**
 * 获取所有追踪的仓库列表
 * @returns {Promise<Array<{owner: string, repo: string}>>}
 */
export async function getAllTrackedRepos() {
    try {
        const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: DATA_PATH_PREFIX,
            ref: DATA_BRANCH,
        });

        if (!Array.isArray(data)) {
            return [];
        }

        const repos = [];
        for (const item of data) {
            if (item.type === "dir") {
                const repoOwner = item.name;
                try {
                    const { data: subItems } = await octokit.rest.repos.getContent({
                        owner,
                        repo,
                        path: `${DATA_PATH_PREFIX}/${repoOwner}`,
                        ref: DATA_BRANCH,
                    });

                    if (Array.isArray(subItems)) {
                        for (const subItem of subItems) {
                            if (subItem.name.endsWith(".json")) {
                                repos.push({
                                    owner: repoOwner,
                                    repo: subItem.name.replace(".json", ""),
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error fetching repos for owner ${repoOwner}:`, error.message);
                }
            }
        }

        return repos;
    } catch (error) {
        if (error.status === 404) {
            return [];
        }
        throw error;
    }
}

/**
 * 清空 data 分支
 */
export async function clearDataBranch() {
    try {
        await execGit(`git fetch origin ${DATA_BRANCH}`);
        await execGit(`git checkout ${DATA_BRANCH}`);

        try {
            await execGit(`git rm -rf .`);
        } catch (error) {
            if (error.message.includes("pathspec '.' did not match any files")) {
                console.log("  Data branch is already empty");
            } else {
                throw error;
            }
        }

        await execGit(`git commit -m "Clear data branch" --allow-empty`);
        await execGit(`git push origin ${DATA_BRANCH} --force`);
        await execGit(`git checkout main`);
        console.log("Cleared data branch");
    } catch (error) {
        console.error("Error clearing data branch:", error.message);
        throw error;
    }
}

/**
 * 批量保存仓库数据
 * @param {Array<{owner: string, repo: string, message_id: number, commit_id: string}>} updates - 更新数据列表
 */
export async function batchSaveRepoData(updates) {
    if (updates.length === 0) {
        return;
    }

    try {
        await execGit(`git checkout ${DATA_BRANCH}`);

        for (const update of updates) {
            const path = `${DATA_PATH_PREFIX}/${update.owner}/${update.repo}.json`;
            const content = JSON.stringify({
                message_id: update.message_id,
                commit_id: update.commit_id,
            }, null, 2);

            const fs = await import("fs");
            const { join } = await import("path");
            const filePath = join(process.cwd(), path);

            await fs.promises.mkdir(join(process.cwd(), DATA_PATH_PREFIX, update.owner), { recursive: true });
            await fs.promises.writeFile(filePath, content, "utf-8");
        }

        await execGit(`git add ${DATA_PATH_PREFIX}`);
        await execGit(`git commit -m "Update repository data"`);
        await execGit(`git push origin ${DATA_BRANCH}`);
        await execGit(`git checkout main`);

        console.log(`Saved ${updates.length} repository data entries`);
    } catch (error) {
        console.error("Error batch saving repository data:", error.message);
        throw error;
    }
}
