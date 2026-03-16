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
    repoPath: "/home/user/grexa-app-preprod",
    buildOutput: "/home/user/grexa-app-preprod/build/web",
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
    repoPath: "/home/user/grexa-app-bira",
    buildOutput: "/home/user/grexa-app-bira/build/web",
    flavor: "dev",
    remote: {
      host: "10.160.0.10",
      user: "sumant",
      path: "/var/www/preprod-app/bira-web",
    },
  },
};

export default ENVS;
