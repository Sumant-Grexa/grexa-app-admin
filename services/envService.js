import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

const NGINX_TEMPLATE = join(__dirname, "../templates/nginx.conf");
const NGINX_DOMAIN = process.env.NGINX_DOMAIN || "grexa.ai";

/**
 * Derive the git remote URL from the existing preprod-web repo clone.
 * Falls back to SOURCE_REPO_URL env var if set.
 * @returns {Promise<string>}
 */
async function getSourceRepoUrl() {
  if (process.env.SOURCE_REPO_URL) return process.env.SOURCE_REPO_URL;
  const basePath = process.env.SOURCE_REPO_BASE || "/home/ubuntu/grexa-app/preprod-web";
  const { stdout } = await execAsync(`git -C ${basePath} remote get-url origin`);
  return stdout.trim();
}

/**
 * Build the nginx server_name from subdomain + optional domain.
 * @param {string} subdomain
 */
function resolveServerName(subdomain) {
  return NGINX_DOMAIN ? `${subdomain}.${NGINX_DOMAIN}` : subdomain;
}

/**
 * Provision a new environment:
 *  - Source VM: git clone preprod-web → {id}-web
 *  - Target VM: mkdir build output, create + enable nginx config, reload nginx
 * @param {{ id: string, subdomain: string, repoPath: string, remote: { host: string, user: string, path: string } }} env
 * @returns {Promise<string[]>} log lines
 */
export async function provisionEnv(env) {
  const log = [];
  const { id, subdomain, repoPath, remote } = env;
  const { host, user, path: remotePath } = remote;
  const ssh = (cmd) => execAsync(`ssh ${user}@${host} "${cmd}"`);

  // 1. Clone repo on source VM
  const repoUrl = await getSourceRepoUrl();
  log.push(`Cloning ${repoUrl} → ${repoPath}`);
  await execAsync(`git clone ${repoUrl} ${repoPath}`);

  // 2. Create web root directory on target VM
  log.push(`Creating web root on target VM: ${remotePath}`);
  await ssh(`sudo mkdir -p ${remotePath} && sudo chown ${user}:${user} ${remotePath}`);

  // 3. Build nginx config from template, upload and enable it
  const serverName = resolveServerName(subdomain);
  const nginxFileName = serverName;
  const template = readFileSync(NGINX_TEMPLATE, "utf-8");
  const config = template
    .replace(/\{serverName\}/g, serverName)
    .replace(/\{env\}/g, id);

  const tmpFile = join(tmpdir(), `grexa-nginx-${nginxFileName}`);
  writeFileSync(tmpFile, config, "utf-8");

  log.push(`Uploading nginx config for ${serverName}`);
  await execAsync(`scp ${tmpFile} ${user}@${host}:/tmp/${nginxFileName}`);
  unlinkSync(tmpFile);

  await ssh(
    `sudo mv /tmp/${nginxFileName} /etc/nginx/sites-available/${nginxFileName} && ` +
    `sudo ln -sf /etc/nginx/sites-available/${nginxFileName} /etc/nginx/sites-enabled/${nginxFileName} && ` +
    `sudo find /etc/nginx/sites-enabled/ -maxdepth 1 -xtype l -delete && ` +
    `sudo ln -sf /etc/nginx/sites-available/${nginxFileName} /etc/nginx/sites-enabled/${nginxFileName} && ` +
    `sudo nginx -t && sudo systemctl reload nginx`
  );
  log.push(`Nginx config created and enabled.`);

  return log;
}

/**
 * Deprovision an environment:
 *  - Target VM: remove nginx config (sites-available + sites-enabled), remove web root
 *  - Source VM: remove cloned repo
 * @param {{ id: string, repoPath: string, remote: { host: string, user: string, path: string } }} env
 * @returns {Promise<string[]>} log lines
 */
export async function deprovisionEnv(env) {
  const log = [];
  const { subdomain, repoPath, remote } = env;
  const { host, user, path: remotePath } = remote;
  const ssh = (cmd) => execAsync(`ssh ${user}@${host} "${cmd}"`);
  const nginxFileName = resolveServerName(subdomain);

  // 1. Remove nginx config on target VM
  log.push(`Removing nginx config on target VM`);
  await ssh(
    `sudo rm -f /etc/nginx/sites-enabled/${nginxFileName} /etc/nginx/sites-available/${nginxFileName} && ` +
    `sudo nginx -t && sudo systemctl reload nginx`
  );

  // 2. Remove web root on target VM
  log.push(`Removing web root on target VM: ${remotePath}`);
  await ssh(`sudo rm -rf ${remotePath}`);

  // 3. Remove source repo on source VM
  log.push(`Removing source repo: ${repoPath}`);
  await execAsync(`rm -rf ${repoPath}`);

  return log;
}
