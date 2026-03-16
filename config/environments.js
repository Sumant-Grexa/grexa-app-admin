/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   subdomain: string,
 *   repoPath: string,
 *   buildOutput: string,
 *   flavor: string,
 *   remote: { host: string, user: string, path: string }
 * }} Env
 */

/** @type {Record<string, Env>} */
const ENVS = {
  preprod: {
    id: "preprod",
    label: "Pre-prod",
    subdomain: "preprod-app",
    repoPath: "/Users/admin/Desktop/grexa-app",
    buildOutput: "/Users/admin/Desktop/grexa-app/build/web",
    flavor: "dev",
    remote: {
      host: "10.160.0.10",
      user: "sumant",
      path: "/var/www/preprod-app/web",
    },
  },
  bira: {
    id: "bira",
    label: "Bira",
    subdomain: "bira",
    repoPath: "/Users/admin/Desktop/Grexa/grexa-app-botified",
    buildOutput: "/Users/admin/Desktop/Grexa/grexa-app-botified/build/web",
    flavor: "dev",
    remote: {
      host: "10.160.0.10",
      user: "sumant",
      path: "/var/www/preprod-app/bira-web",
    },
  },
};

export default ENVS;
