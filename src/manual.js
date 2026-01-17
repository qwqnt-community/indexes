import { getRepoInfo } from "./github/repos.js";
import { saveRepoData, deleteRepoData } from "./github/data.js";

const { MANUAL_ACTION, MANUAL_OWNER, MANUAL_REPO } = process.env;

if (!MANUAL_ACTION || !MANUAL_OWNER || !MANUAL_REPO) {
    console.error("missing required environment variables: MANUAL_ACTION, MANUAL_OWNER, MANUAL_REPO");
    process.exit(1);
}

/**
 * 手动添加仓库到追踪列表
 */
async function addRepo() {
    console.log(`Adding ${MANUAL_OWNER}/${MANUAL_REPO} to tracking...`);

    const repoInfo = await getRepoInfo(MANUAL_OWNER, MANUAL_REPO);
    if (!repoInfo) {
        console.error(`Repository ${MANUAL_OWNER}/${MANUAL_REPO} not found`);
        process.exit(1);
    }

    await saveRepoData(MANUAL_OWNER, MANUAL_REPO, {
        message_id: 0,
        commit_id: "",
    });

    console.log(`Successfully added ${MANUAL_OWNER}/${MANUAL_REPO} to tracking`);
}

/**
 * 手动从追踪列表中删除仓库
 */
async function removeRepo() {
    console.log(`Removing ${MANUAL_OWNER}/${MANUAL_REPO} from tracking...`);

    await deleteRepoData(MANUAL_OWNER, MANUAL_REPO);

    console.log(`Successfully removed ${MANUAL_OWNER}/${MANUAL_REPO} from tracking`);
}

/**
 * 主函数
 */
async function main() {
    try {
        if (MANUAL_ACTION === "add") {
            await addRepo();
        } else if (MANUAL_ACTION === "remove") {
            await removeRepo();
        } else {
            console.error(`Invalid action: ${MANUAL_ACTION}. Must be 'add' or 'remove'`);
            process.exit(1);
        }
    } catch (error) {
        console.error("Error during manual operation:", error);
        process.exit(1);
    }
}

main().then();
