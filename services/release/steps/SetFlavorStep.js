import { exec } from "child_process";
import { ReleaseStep } from "./ReleaseStep.js";

export class SetFlavorStep extends ReleaseStep {
  async run(ctx) {
    await new Promise((resolve, reject) => {
      const child = exec("./scripts/set-flavor.sh prod", { cwd: ctx.repoPath });

      const pipe = (data) =>
        String(data)
          .split("\n")
          .forEach((l) => l.trim() && ctx.append(`  ${l}`));

      child.stdout?.on("data", pipe);
      child.stderr?.on("data", pipe);
      child.on("close", (code) =>
        code === 0
          ? resolve(undefined)
          : reject(new Error(`set-flavor.sh exited with code ${code}`))
      );
    });
  }
}
