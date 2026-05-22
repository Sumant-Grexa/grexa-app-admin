import { join } from "path";
import { getReleaseConfig } from "../../config/releaseConfig.js";

/**
 * @typedef {{
 *   version: string,
 *   releaseNotes: string,
 *   platforms: string[],
 *   iosReleaseType: "full" | "phased" | "manual",
 *   track: string,
 *   userFraction: number,
 *   runBuildRunner: boolean,
 *   repoPath: string,
 *   aabPath: string,
 *   ipaPath: string,
 *   android: { versionCode: number | null, editId: string | null },
 *   ios: { buildId: string | null, versionId: string | null },
 *   web: {},
 *   platformErrors: Record<string, string>,
 *   tagName: string | null,
 *   githubNotes: string | null,
 *   log: string[],
 *   append: (line: string) => void,
 * }} ReleaseContext
 */

/**
 * @param {{ version: string, releaseNotes: string, platforms: string[], iosReleaseType: string, track: string, userFraction: number, runBuildRunner: boolean }} options
 * @returns {ReleaseContext}
 */
export function createReleaseContext(options) {
  const { repoPath } = getReleaseConfig();

  const ctx = {
    // inputs
    version:        options.version,
    releaseNotes:   options.releaseNotes ?? "",
    platforms:      options.platforms ?? ["android"],
    iosReleaseType: options.iosReleaseType ?? "full",
    track:          options.track ?? "production",
    userFraction:   options.userFraction ?? 0.1,
    runBuildRunner: options.runBuildRunner ?? false,

    // derived paths
    repoPath,
    aabPath: join(repoPath, "build/app/outputs/bundle/prodRelease/app-prod-release.aab"),
    ipaPath: join(repoPath, "build/ios/ipa/Runner.ipa"),

    // namespaced output slots — each platform only writes its own namespace
    android: { versionCode: null, editId: null },
    ios:     { buildId: null, versionId: null },
    web:     {},

    // per-platform error tracking
    platformErrors: {},

    // finalization slots
    tagName:     null,
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
