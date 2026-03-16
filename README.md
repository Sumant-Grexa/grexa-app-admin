# Grexa Deployer

A minimal web UI to manage branch deployments across Grexa preprod Flutter environments.

## What it does

- Shows the currently live branch for each environment
- Lets you fetch git branches and pick one to deploy
- Runs `flutter build web` on the **Deployer VM**, then rsyncs the output to the **Serve VM**
- Streams build logs live in the UI
- Simple password-protected session

---

## Architecture

```
Deployer VM                          Serve VM (10.160.0.10)
────────────────────────────         ──────────────────────────────
grexa-deployer (this app)            nginx
app source repos                     /var/www/preprod-app/
git pull + flutter build   ──rsync→  subdomain DNS + TLS
```

---

## Project structure

```
grexa-web-admin/
├── server.js                  ← app entry point
├── config/
│   └── environments.js        ← environment definitions (paths, remote host)
├── middleware/
│   └── auth.js                ← session auth guard
├── services/
│   └── deployService.js       ← git, flutter build, rsync logic
├── controllers/
│   ├── authController.js      ← login / logout / me
│   └── deployController.js    ← status / branches / deploy / log
├── routes/
│   ├── index.js               ← mounts auth + deploy routers
│   ├── auth.js
│   └── deploy.js
└── public/                    ← static frontend
```

---

## Deployer VM setup

### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Clone / copy the project

```bash
git clone <repo> /home/user/grexa-deployer
# or: scp -r grexa-deployer/ user@deployer-vm:/home/user/grexa-deployer
```

### 3. Install dependencies

```bash
cd /home/user/grexa-deployer
npm install
```

### 4. Configure environments

Edit `config/environments.js` — set `repoPath`, `buildOutput`, `flavor`, and `remote` for each environment:

```js
remote: {
  host: "10.160.0.10",   // Serve VM IP or hostname
  user: "sumant",        // SSH user on Serve VM
  path: "/var/www/preprod-app/web",
}
```

### 5. Set up SSH key access to Serve VM

The deployer must be able to rsync to the Serve VM without a password prompt:

```bash
# Generate key if needed
ssh-keygen -t ed25519 -C "grexa-deployer"

# Copy public key to Serve VM
ssh-copy-id sumant@10.160.0.10

# Test
ssh sumant@10.160.0.10 "echo ok"
```

### 6. Make sure flutter is in PATH

```bash
which flutter   # should return a path
# If not, add flutter/bin to PATH in ~/.bashrc or in the .service file
```

### 7. Set your password (optional)

Default is `grexa@preprod`. Override via env var:

```bash
export DEPLOY_PASSWORD="your-secure-password"
```

---

## Run as a systemd service

```bash
sudo cp grexa-deployer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable grexa-deployer
sudo systemctl start grexa-deployer
sudo systemctl status grexa-deployer
```

The `.service` file sets `DEPLOY_PASSWORD`, `PORT`, and adds `flutter/bin` to `PATH`.

---

## Expose deployer UI via nginx (Deployer VM)

```nginx
server {
    listen 80;
    server_name deployer.yourdomain.com;

    root /home/user/grexa-deployer/public;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3456;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Serve VM setup

Create the target directories and ensure the SSH user owns them:

```bash
sudo mkdir -p /var/www/preprod-app/web
sudo mkdir -p /var/www/preprod-app/bira-web
sudo chown -R sumant:sumant /var/www/preprod-app
```

Then configure nginx on the Serve VM to serve each path under its subdomain as a normal static site.
