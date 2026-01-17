import { Octokit } from "@octokit/rest";

const { CUSTOM_GITHUB_TOKEN } = process.env;
if (!CUSTOM_GITHUB_TOKEN) {
    console.error("missing required environment variables.");
    process.exit(1);
}

export const octokit = new Octokit({ auth: CUSTOM_GITHUB_TOKEN });
