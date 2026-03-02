import { octokit } from "./client.js";
import { promises as fs } from "fs";
import { join } from "path";

const { GITHUB_REPOSITORY } = process.env;
if (!GITHUB_REPOSITORY) {
    console.error("missing GITHUB_REPOSITORY environment variable.");
    process.exit(1);
}

const [owner, repo] = GITHUB_REPOSITORY.split("/");
const DATA_BRANCH = "data";
const DATA_PATH_PREFIX = "repos";

/**
 * 执行 Git 命令
 */
async function execGit(command) {
    const { exec } = await import("child_process");
    return new Promise((resolve, reject) => {
        exec(command, { encoding: "utf-8" }, (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout.trim());
        });
    });
}

/**
 * 获取仓库数据 (通过 API 读取)
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

        if (Array.isArray(data)) return null;
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        return JSON.parse(content);
    } catch (error) {
        if (error.status === 404) return null;
        throw error;
    }
}

/**
 * 获取所有追踪的仓库列表 (通过 API 读取)
 */
export async function getAllTrackedRepos() {
    try {
        const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: DATA_PATH_PREFIX,
            ref: DATA_BRANCH,
        });

        if (!Array.isArray(data)) return [];

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
        if (error.status === 404) return [];
        throw error;
    }
}

/**
 * 将全部仓库数据转存到 data 分支，并在该分支上创建唯一新提交 (Single-commit storage)
 * @param {Array<{owner: string, repo: string, message_id: number, commit_id: string}>} allUpdates - 所有的最新数据
 */
export async function batchSaveRepoData(allUpdates) {
    if (allUpdates.length === 0) return;

    try {
        console.log("Preparing to save all repository data to a new isolated commit...");

        // 创建一个孤立分支 (没有历史记录)
        await execGit(`git checkout --orphan temp_data_branch`);

        // 清空当前工作区中除了 .git 之外的所有内容（实际上 --orphan 后工作区包含原分支内容，我们需要移除它）
        try {
            await execGit(`git rm -rf .`);
        } catch (error) {
            if (!error.message.includes("did not match any files")) throw error;
        }

        // 把文件写到对应目录
        for (const update of allUpdates) {
            const dirPath = join(process.cwd(), DATA_PATH_PREFIX, update.owner);
            const filePath = join(dirPath, `${update.repo}.json`);

            const content = JSON.stringify({
                message_id: update.message_id,
                commit_id: update.commit_id,
            }, null, 2);

            await fs.mkdir(dirPath, { recursive: true });
            await fs.writeFile(filePath, content, "utf-8");
        }

        // 提交变更
        await execGit(`git add ${DATA_PATH_PREFIX}`);
        await execGit(`git commit -m "Update repository data [skip ci]"`);

        // 强制推送到远程的 data 分支
        await execGit(`git push origin temp_data_branch:${DATA_BRANCH} --force`);

        // 切回主分支，清理临时分支
        await execGit(`git checkout main`);
        await execGit(`git branch -D temp_data_branch`);

        console.log(`Saved ${allUpdates.length} repository data entries successfully.`);
    } catch (error) {
        console.error("Error batch saving repository data:", error.message);
        // 尝试恢复现场
        try { await execGit(`git checkout main`); } catch (e) { }
        throw error;
    }
}

/**
 * 手动保存单个仓库数据 (为 manual.js 使用)
 * @param {string} repoOwner 
 * @param {string} repoName 
 * @param {object} newData 
 */
export async function saveRepoData(repoOwner, repoName, newData) {
    const trackedRepos = await getAllTrackedRepos();
    const allUpdates = [];

    // 获取现有所有的记录
    for (const repo of trackedRepos) {
        if (repo.owner === repoOwner && repo.repo === repoName) continue; // 跳过当前要更新的，后面会加

        const data = await getRepoData(repo.owner, repo.repo);
        if (data) Object.assign(repo, data);
        allUpdates.push(repo);
    }

    // 加入新增的这一个
    allUpdates.push({
        owner: repoOwner,
        repo: repoName,
        message_id: newData.message_id || 0,
        commit_id: newData.commit_id || ""
    });

    await batchSaveRepoData(allUpdates);
}

/**
 * 手动删除单个仓库数据 (为 manual.js 使用)
 * @param {string} repoOwner 
 * @param {string} repoName 
 */
export async function deleteRepoData(repoOwner, repoName) {
    const trackedRepos = await getAllTrackedRepos();
    const allUpdates = [];

    let found = false;
    for (const repo of trackedRepos) {
        if (repo.owner === repoOwner && repo.repo === repoName) {
            found = true;
            continue; // 跳过要删除的这个
        }
        const data = await getRepoData(repo.owner, repo.repo);
        if (data) Object.assign(repo, data);
        allUpdates.push(repo);
    }

    if (!found) {
        console.log(`Repository ${repoOwner}/${repoName} was not tracked.`);
        return;
    }

    await batchSaveRepoData(allUpdates);
}

