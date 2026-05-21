import { join } from "path";
import { getReleaseConfig } from "../../config/releaseConfig.js";

/**
 * @typedef {{
 *   version: string,
 *   releaseNotes: string,
 *   track: string,
 *   userFraction: number,
 *   runBuildRunner: boolean,
 *   repoPath: string,
 *   aabPath: string,
 *   ipaPath: string,
 *   versionCode: number | null,
 *   editId: string | null,
 *   tagName: string | null,
 *   githubNotes: string | null,
 *   log: string[],
 *   append: (line: string) => void,
 * }} ReleaseContext
 */

/**
 * @param {{ version: string, releaseNotes: string, track: string, userFraction: number, runBuildRunner: boolean }} options
 * @returns {ReleaseContext}
 */
export function createReleaseContext(options) {
  const { repoPath } = getReleaseConfig();

  const ctx = {
    // inputs
    version: options.version,
    releaseNotes: options.releaseNotes ?? "",
    track: options.track ?? "production",
    userFraction: options.userFraction ?? 0.1,
    runBuildRunner: options.runBuildRunner ?? false,

    // derived paths
    repoPath,
    aabPath: join(repoPath, "build/app/outputs/bundle/prodRelease/app-prod-release.aab"),
    ipaPath: join(repoPath, "build/ios/ipa/Runner.ipa"),

    // output slots — filled by steps
    versionCode: null,
    editId: null,
    tagName: null,
    githubNotes: null,

    // live log
    log: [],
    append(line) {
      this.log.push(line);
      console.log(`[release] ${line}`);
    },
  };

  return ctx;
}
