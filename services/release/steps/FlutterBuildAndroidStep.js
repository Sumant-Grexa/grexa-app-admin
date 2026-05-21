import { exec } from "child_process";
import { existsSync } from "fs";
import { ReleaseStep } from "./ReleaseStep.js";

export class FlutterBuildAndroidStep extends ReleaseStep {
  async run(ctx) {
    await new Promise((resolve, reject) => {
      const child = exec(
        "flutter build appbundle --flavor prod -t lib/main_prod.dart",
        { cwd: ctx.repoPath }
      );

      const streamLines = (data) => {
        data
          .toString()
          .split("\n")
          .filter((line) => line.trim() !== "")
          .forEach((line) => ctx.append(`  ${line}`));
      };

      child.stdout.on("data", streamLines);
      child.stderr.on("data", streamLines);

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`flutter build appbundle failed with exit code ${code}`));
        } else {
          resolve();
        }
      });

      child.on("error", reject);
    });

    if (!existsSync(ctx.aabPath)) {
      throw new Error(`AAB not found at ${ctx.aabPath}`);
    }
  }
}
