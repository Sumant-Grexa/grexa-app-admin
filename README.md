# Grexa Deployer

A minimal web UI to manage branch deployments across your two preprod Flutter environments.

## What it does

- Shows the currently deployed branch for each environment
- Lets you fetch all available git branches and pick one to deploy
- Runs `flutter build web --dart-define=FLAVOR=dev`, then copies `build/web` to the nginx directory
- Streams build logs live in the UI
- Simple password protection

---

## Setup

### 1. Install Node.js (if not present)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Copy files to the VM

Copy the `grexa-deployer/` folder to your VM, e.g.:

```bash
scp -r grexa-deployer/ user@your-vm:/home/user/grexa-deployer
```

### 3. Install dependencies

```bash
cd /home/user/grexa-deployer
npm install
```

### 4. Set your password (optional)

The default password is `grexa@preprod`. Override it with an env var:

```bash
export DEPLOY_PASSWORD="your-secure-password"
```

### 5. Make sure flutter is in PATH for the server process

```bash
which flutter   # should return a path
# If not, add to ~/.bashrc or pass full path in deploy.js
```

### 6. Run it

```bash
node server.js
# App starts at http://127.0.0.1:3456
```

---

## Run as a systemd service (recommended)

Copy the included `grexa-deployer.service` to systemd:

```bash
sudo cp grexa-deployer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable grexa-deployer
sudo systemctl start grexa-deployer
sudo systemctl status grexa-deployer
```

---

## Access via nginx (optional 3rd subdomain)

Add a new nginx server block:

```nginx
server {
    listen 80;
    server_name deployer.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3456;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then reload nginx: `sudo systemctl reload nginx`

---

## Configuration

Edit `routes/deploy.js` → `ENVS` object to change paths, labels, or the flutter flavor:

```js
const ENVS = {
  preprod: {
    repoPath:    "/home/user/grexa-app-preprod",
    buildOutput: "/home/user/grexa-app-preprod/build/web",
    nginxPath:   "/var/www/preprod-app/web",
    flavor:      "dev",
    ...
  },
  bira: { ... }
};
```

---

## Permissions note

The Node process needs write access to the nginx directories. Either:

- Run as a user that owns `/var/www/preprod-app/`, or
- Use `sudo chown -R user:user /var/www/preprod-app/`
