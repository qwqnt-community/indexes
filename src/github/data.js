import { octokit } from "./client.js";
import { promises as fs } from "fs";
import { join } from "path";

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
 * 清空 data 分支并切换
 */
export async function clearDataBranch() {
    try {
        await execGit(`git fetch origin ${DATA_BRANCH}`);
        await execGit(`git checkout ${DATA_BRANCH}`);

        try {
            await execGit(`git rm -rf .`);
        } catch (error) {
            if (!error.message.includes("did not match any files")) throw error;
        }

        await execGit(`git commit -m "Clear data branch" --allow-empty`);
        console.log("Cleared data branch locally");
    } catch (error) {
        console.error("Error clearing data branch:", error.message);
        throw error;
    }
}

/**
 * 批量保存仓库数据并推送到远程
 */
export async function batchSaveRepoData(updates) {
    if (updates.length === 0) return;

    try {
        // 假设已经在 data 分支（由 clearDataBranch 切换）
        for (const update of updates) {
            const dirPath = join(process.cwd(), DATA_PATH_PREFIX, update.owner);
            const filePath = join(dirPath, `${update.repo}.json`);
            
            const content = JSON.stringify({
                message_id: update.message_id,
                commit_id: update.commit_id,
            }, null, 2);

            await fs.mkdir(dirPath, { recursive: true });
            await fs.writeFile(filePath, content, "utf-8");
        }

        await execGit(`git add ${DATA_PATH_PREFIX}`);
        await execGit(`git commit -m "Update repository data [skip ci]"`);
        await execGit(`git push origin ${DATA_BRANCH} --force`);
        await execGit(`git checkout main`);

        console.log(`Saved ${updates.length} repository data entries`);
    } catch (error) {
        console.error("Error batch saving repository data:", error.message);
        throw error;
    }
}

