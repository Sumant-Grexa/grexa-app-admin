import { exec } from "child_process";
import { ReleaseStep } from "./ReleaseStep.js";

export class BuildRunnerStep extends ReleaseStep {
  async run(ctx) {
    await new Promise((resolve, reject) => {
      const child = exec(
        "dart run build_runner build --delete-conflicting-outputs",
        { cwd: ctx.repoPath }
      );

      const streamLines = (data) => {
        data.toString().split("\n").forEach((line) => {
          if (line.trim()) ctx.append(`  ${line}`);
        });
      };

      child.stdout?.on("data", streamLines);
      child.stderr?.on("data", streamLines);

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`build_runner exited with code ${code}`));
        } else {
          resolve();
        }
      });

      child.on("error", reject);
    });
  }
}
