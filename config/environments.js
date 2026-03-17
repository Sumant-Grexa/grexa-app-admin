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
    repoPath: "/home/ubuntu/grexa-app/preprod-web",
    buildOutput: "/home/ubuntu/grexa-app/preprod-web/build/web",
    flavor: "dev",
    remote: {
      host: "34.47.166.243",
      user: "sumant",
      path: "/var/www/preprod-app/web",
    },
  },
  bira: {
    id: "bira",
    label: "Bira",
    subdomain: "bira",
    repoPath: "/home/ubuntu/grexa-app/bira-web",
    buildOutput: "/home/ubuntu/grexa-app/bira-web/build/web",
    flavor: "dev",
    remote: {
      host: "34.47.166.243",
      user: "sumant",
      path: "/var/www/preprod-app/bira-web",
    },
  },
};

export default ENVS;
