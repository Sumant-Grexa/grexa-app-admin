import { ReleaseStep } from "./ReleaseStep.js";
import { getReleaseConfig } from "../../../config/releaseConfig.js";

export class GitHubNotesStep extends ReleaseStep {
  async run(ctx) {
    try {
      const { githubToken, githubRepo } = getReleaseConfig();

      const response = await fetch(
        `https://api.github.com/repos/${githubRepo}/releases/generate-notes`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tag_name: ctx.tagName, target_commitish: "master" }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        ctx.githubNotes = data.body;
        ctx.append("── Release Notes ──");
        for (const line of ctx.githubNotes.split("\n")) {
          ctx.append(line);
        }
      }
    } catch (err) {
      ctx.append(`GitHub notes unavailable: ${err.message}`);
    }
  }
}
