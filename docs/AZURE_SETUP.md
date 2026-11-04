# Azure VM setup and first deployment (task P3-09)

For the person who owns the Azure subscription. You know Azure; you do not need to know this project.
Allow about 45 minutes. The result is one Ubuntu VM that runs the whole site (Nginx, 3 backend replicas
and the player challenge containers). Only login (AWS Cognito) and the database (MongoDB Atlas) live elsewhere.

```
Internet --80/443--> Azure NSG --> VM: Nginx --> backend x3 --> MongoDB Atlas
                                       \--> player challenge containers on ports 30000-30100
```

Assets in this repo: `deploy/azure-setup.sh` (installs Docker, swap, firewall), `deploy/deploy.sh` (build and start
the stack), `.github/workflows/deploy.yml` (auto-deploy on push to `main`).

## 0. What you need before you start

- An Azure subscription where you can create a resource group, a VM and a public IP.
- Azure CLI (`az`) on your laptop, or use the portal (each step shows both).
- An SSH key pair for yourself: `ssh-keygen -t ed25519` (public key at `~/.ssh/id_ed25519.pub`).
- From the team (shared privately, never in chat history or git): the MongoDB Atlas connection string and the
  four Cognito values (region, user pool ID, app client ID). See `docs/SETUP.md` sections 3 and 4.
- Read access to the GitHub repository from the VM (step 5).

## 1. Choose names and region

```bash
az login
az account set --subscription "<subscription name or id>"

RG=ctf-arena-rg
LOC=centralindia                  # a region near your players
VM=ctf-arena-vm
ADMIN=azureuser
DNS_LABEL=ctf-arena-<something-unique>   # becomes <label>.<region>.cloudapp.azure.com
MY_IP=$(curl -s https://api.ipify.org)   # your current public IP, for the SSH rule
```

## 2. Create the resource group, static public IP, network rules and VM

**Size:** at least 2 GB RAM. Recommended `Standard_B2s` (2 vCPU, 4 GB). For a live demo with many teams use
`Standard_B2ms` (8 GB): every running challenge container reserves up to 128 MB, and the three backends, Nginx and
the OS need about 1 GB (see section 12).

```bash
az group create --name $RG --location $LOC

# Static public IP (Standard SKU is always static) plus a free DNS name.
az network public-ip create --resource-group $RG --name ctf-arena-ip \
  --sku Standard --allocation-method Static --dns-name $DNS_LABEL

az network nsg create --resource-group $RG --name ctf-arena-nsg

# Inbound rules (everything else is denied by default).
az network nsg rule create -g $RG --nsg-name ctf-arena-nsg -n allow-ssh --priority 100 \
  --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 22 \
  --source-address-prefixes "$MY_IP"
az network nsg rule create -g $RG --nsg-name ctf-arena-nsg -n allow-http --priority 110 \
  --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 80 --source-address-prefixes '*'
az network nsg rule create -g $RG --nsg-name ctf-arena-nsg -n allow-https --priority 120 \
  --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 443 --source-address-prefixes '*'
az network nsg rule create -g $RG --nsg-name ctf-arena-nsg -n allow-challenges --priority 130 \
  --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 30000-30100 --source-address-prefixes '*'

az vm create --resource-group $RG --name $VM \
  --image Ubuntu2204 --size Standard_B2s \
  --admin-username $ADMIN --authentication-type ssh --ssh-key-values ~/.ssh/id_ed25519.pub \
  --public-ip-address ctf-arena-ip --nsg ctf-arena-nsg \
  --os-disk-size-gb 64 --storage-sku StandardSSD_LRS

az network public-ip show -g $RG -n ctf-arena-ip --query "{ip:ipAddress, dns:dnsSettings.fqdn}" -o table
```

(`Ubuntu2404` also works as the image alias on a recent `az`.) Portal equivalent: Create a resource > Virtual
machine > Ubuntu Server 22.04 or 24.04 LTS, size B2s, authentication SSH public key, create a **new static
Standard public IP** with a DNS name label, NIC network security group "Advanced" with the rules below, OS disk 64 GB.

### Inbound NSG rules

| Priority | Name | Port | Source | Why |
|----------|------|------|--------|-----|
| 100 | allow-ssh | 22/tcp | **known IPs only** (your IP, the team's IPs) | administration. Password login is off by default on Azure; keys only |
| 110 | allow-http | 80/tcp | Any | the website and API |
| 120 | allow-https | 443/tcp | Any | optional, only if you enable HTTPS (`docs/SECURITY.md`) |
| 130 | allow-challenges | 30000-30100/tcp | Any | players open their challenge containers here |

Do **not** open 4000 (backend), 27017 or 2375/2376 (Docker API) to anyone.

**SSH and the GitHub Actions deploy.** GitHub-hosted runners come from large, changing IP ranges, so an SSH rule
limited to team IPs blocks the automatic deploy. Choose one:

| Option | Trade-off |
|--------|-----------|
| A. Open 22 to Any, keep key-only login, use a dedicated deploy key (step 11) | simple; scanners will hit SSH but cannot log in. Optional: `sudo apt install fail2ban` |
| B. Keep 22 restricted and deploy by hand: `ssh` in, `git pull --ff-only`, `bash deploy/deploy.sh` | tightest; no auto-deploy |
| C. Restrict 22 and install a self-hosted GitHub runner on the VM | tight and automatic, more setup |

For the course demo A is reasonable. Write down which one you chose in the report.

## 3. Connect

```bash
ssh azureuser@<DNS name or IP>
```

To let teammates in, append their public keys (one per line) to `~/.ssh/authorized_keys` on the VM.

## 4. Get the code

Public repository:

```bash
git clone https://github.com/swarupio/ctf-arena.git ~/ctf-arena
```

Private repository: create a read-only deploy key on the VM and add its **public** half in GitHub, repository
Settings > Deploy keys (leave "Allow write access" off):

```bash
ssh-keygen -t ed25519 -N '' -f ~/.ssh/github_deploy -C "ctf-arena-vm"
cat ~/.ssh/github_deploy.pub                       # paste into GitHub
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
ssh-keyscan github.com >> ~/.ssh/known_hosts
git clone git@github.com:swarupio/ctf-arena.git ~/ctf-arena
```

## 5. Install Docker, swap and the firewall

```bash
cd ~/ctf-arena
bash deploy/azure-setup.sh
```

It is safe to run again. It prints the **`DOCKER_GID`** to use in step 7 and, when run on Azure, the public IP.
Then **log out and back in** so your user is in the `docker` group, and check:

```bash
exit
ssh azureuser@<host>
docker run --rm hello-world && docker compose version
```

## 6. Add the VM to MongoDB Atlas

Atlas > Network Access > Add IP Address > the VM's **public IP**. Remove any `0.0.0.0/0` entry once this works.

## 7. Create `.env`

```bash
cd ~/ctf-arena
cp .env.example .env
chmod 600 .env
nano .env
```

Change at least these (never paste real values into git, issues or chat):

| Variable | Production value |
|----------|------------------|
| `NODE_ENV` | `production` |
| `PORT` | leave `4000` (Nginx proxies to it) |
| `MONGODB_URI` | the Atlas SRV string, database `ctf_arena` |
| `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | from the Cognito user pool |
| `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` | same three values. They are baked into the website at build time, so set them **before** step 8 |
| `PUBLIC_HOST` | the VM's public IP or DNS name, exactly what players type (no `http://`, no port). Instance links are built from it |
| `FLAG_SECRET` | a private random value of at least 32 characters (see below). Set it once; changing it later changes every team's flags |
| `CHALLENGE_PORT_MIN`, `CHALLENGE_PORT_MAX` | keep `30000` and `30100` (they match the NSG rule) |
| `INSTANCE_TTL_MINUTES`, `MAX_INSTANCES_PER_TEAM`, `CHALLENGE_MEMORY_MB`, `CHALLENGE_CPU_LIMIT`, `CHALLENGE_PIDS_LIMIT` | keep the defaults unless you size the VM for more |

`.env.example` ends with two commented lines that are used by `docker-compose.yml`, not by the backend. Uncomment
`DOCKER_GID` and set it; leave `NGINX_HOST_PORT` commented unless host port 80 is taken:

```
DOCKER_GID=<number printed by the setup script, or: getent group docker | cut -d: -f3>
# NGINX_HOST_PORT=80      # only if you need another host port
```

Generate `FLAG_SECRET`:

```bash
openssl rand -hex 32        # 64 hex characters; paste the output as the value
```

## 8. First deploy

```bash
cd ~/ctf-arena
SEED_CHALLENGES=1 bash deploy/deploy.sh
```

This builds the frontend (in a Node container, so nothing is installed on the VM), builds one `ctf/<slug>` image
for every `challenges/<slug>/Dockerfile`, registers the challenges in MongoDB (including the Arena Terminal codes,
`npm run seed:terminal`), runs `docker compose up -d --build`
and waits for `/api/health`. The first run takes several minutes (image downloads); later runs are fast. The same
script is what the CI/CD pipeline runs. Manual equivalents, if you want to see the steps:

```bash
( cd frontend && npm ci && npm run build )                   # needs Node 20 on the VM
for d in challenges/*/; do s=$(basename "$d"); [ -f "$d/Dockerfile" ] && [ "${s#_}" = "$s" ] && docker build -t "ctf/$s" "$d"; done
docker compose up -d --build
```

## 9. Verify

```bash
curl http://<ip-or-dns>/api/health
# {"status":"ok","db":"up","replica":"3f9c1a..."}      "db":"up" means Atlas is reachable

for i in 1 2 3 4 5 6; do curl -sI http://<ip-or-dns>/api/health | grep -i x-served-by; done   # different replica names
docker compose ps                                          # 3 backend replicas + nginx, all healthy
docker images 'ctf/*'                                      # the challenge images
```

Open `http://<ip-or-dns>` in a browser: the login page loads and the footer shows `Served by <replica>`.
Scale demo: `docker compose up -d --scale backend=5` (no code change), then `docker compose ps`.
Create an admin as described in `docs/SETUP.md` section 7.

## 10. Cognito

Sign-in uses SRP from the browser (Amplify Auth), not the hosted UI, so the app client normally needs **no callback
or sign-out URL**. Only if someone enables Hosted UI / OAuth on the app client, add the production origin
(`http://<PUBLIC_HOST>`, or `https://...` after enabling HTTPS) as an allowed callback and sign-out URL.

## 11. Auto-deploy from GitHub (CI/CD)

Create a key pair used only for deployments, on your laptop:

```bash
ssh-keygen -t ed25519 -N '' -f ./ctf_deploy_key -C "github-actions-deploy"
ssh azureuser@<host> 'cat >> ~/.ssh/authorized_keys' < ctf_deploy_key.pub    # authorise it on the VM
ssh-keyscan -t ed25519 <host>                                                # prints the VM host key line
```

GitHub repository > Settings > Secrets and variables > Actions > New repository secret:

| Secret | Value |
|--------|-------|
| `AZURE_VM_HOST` | public IP or DNS name |
| `AZURE_VM_USER` | `azureuser` |
| `AZURE_VM_SSH_KEY` | the full contents of `ctf_deploy_key` (the private file) |
| `AZURE_VM_HOST_KEY` | optional but recommended: the line printed by `ssh-keyscan` (pins the VM's identity) |

Then delete `ctf_deploy_key` from your laptop. Every push to `main` now runs the tests, SSHes in, runs
`git pull --ff-only` and `deploy/deploy.sh`, and fails if `/api/health` is not ok. NSG option A or C from section 2
is needed for GitHub's runners to reach port 22. You can also run it by hand: Actions > Deploy > Run workflow.

## 12. Giving the demo audience access

- Share `http://<ip-or-dns>` (or the HTTPS name). Players self-register, confirm their email and need an
  authenticator app (Google or Microsoft Authenticator) for MFA. Ask them to bring one.
- Port 80 and 30000-30100 must be open to **Any** (or the campus IP range) in the NSG, or instance links will time out.
- `PUBLIC_HOST` must be that same IP/name, otherwise instance links point to the wrong host.
- Nginx limits each client IP to 20 requests/second (burst 60). A whole classroom behind one campus NAT is fine
  because normal use is well below 1 request per second per player.
- **Capacity:** each running challenge is capped at 128 MB and 0.25 CPU, and each team at 2 instances. A 4 GB VM
  holds roughly 20 simultaneous containers, an 8 GB VM roughly 50. For a big audience either resize the VM
  (`az vm resize`) or set `MAX_INSTANCES_PER_TEAM=1` in `.env` and run `docker compose up -d`.
- Admins: add accounts to the Cognito `admin` group; they get the admin dashboard.

## 13. Everyday operations

```bash
docker compose ps                         # status and health
docker compose logs -f --tail=50 backend  # backend logs (all replicas)
docker compose up -d --scale backend=5    # more replicas
docker ps --filter label=ctf.instance     # running player challenge containers
bash deploy/deploy.sh                     # redeploy the current checkout
REPLICAS=5 bash deploy/deploy.sh          # redeploy and keep 5 replicas
```

A deploy returns the backend to the 3 replicas set in `docker-compose.yml` (`deploy.replicas`) unless you pass
`REPLICAS=<n>`, so a manual `--scale` does not survive the next push to `main`. For a permanent change edit
`deploy.replicas` in `docker-compose.yml`.

**Cost control:** deallocate the VM when you are not using it (`az vm deallocate -g $RG -n $VM`; start with `az vm start`).
The static public IP keeps its address, but a Standard public IP is billed while it exists. The portal also has
VM > Auto-shutdown. After the project: `az group delete --name $RG --yes` removes everything.

## 14. Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `curl /api/health` shows `"db":"down"`, or backends keep restarting with "MongoDB connection failed" | The VM's public IP is not in Atlas Network Access, or `MONGODB_URI` is wrong. Add the IP and `docker compose restart backend` |
| Backend log: `permission denied` on `/var/run/docker.sock`, or starting an instance fails | `DOCKER_GID` missing or wrong in `.env`. Run `getent group docker \| cut -d: -f3`, put the number in `.env`, then `docker compose up -d --force-recreate backend` |
| Site unreachable from outside, works with `curl localhost` on the VM | NSG rule for 80 missing, or the VM has another firewall. Check the NSG, `sudo ufw status`, and `docker compose ps` |
| The challenge list is empty | Challenges are registered only on request: run `SEED_CHALLENGES=1 bash deploy/deploy.sh` once. It prints `Challenges seeded: N created, M updated.` (the same as `npm run seed:challenges` in `backend/`) and then `Terminal challenges seeded: N created, M updated.` (`npm run seed:terminal`) |
| The Terminal page answers `Run npm run seed:terminal.` (503 `TERMINAL_NOT_SEEDED`) | The Arena Terminal codes are registered by the same `SEED_CHALLENGES=1 bash deploy/deploy.sh` run (or `npm run seed:terminal` in `backend/`); repeat it any time, it keeps solve counts |
| An instance is stuck in the admin dashboard and Kill did nothing | Kill is forced and also takes over an instance stuck in `stopping`; if it still fails, check `docker ps --filter label=ctf.instance` and `docker compose logs backend` |
| Instance starts but the link does not open | NSG rule for 30000-30100 missing, or `PUBLIC_HOST` is wrong (still `localhost`). Fix `.env`, `docker compose up -d --force-recreate backend` |
| Login page loads but sign-in says the pool or client is invalid | `VITE_COGNITO_*` was wrong or empty when the frontend was built. Fix `.env`, run `bash deploy/deploy.sh` (rebuilds the frontend) |
| Everything slows down or containers get killed | Out of memory. Check `free -h`, `docker stats --no-stream`. Confirm swap is on (`swapon --show`), lower `MAX_INSTANCES_PER_TEAM`, or resize the VM |
| Backend refuses to start with "Invalid environment configuration" | A variable is missing or `FLAG_SECRET` is shorter than 32 characters. The message names the variable, never its value |
| `deploy.sh`: "Cannot talk to Docker" | Your user is not in the `docker` group yet. Log out and back in |
| GitHub deploy fails at SSH | Wrong `AZURE_VM_*` secret, key not in `authorized_keys`, NSG blocks 22 from GitHub, or the VM host key changed (update `AZURE_VM_HOST_KEY`) |
| GitHub deploy fails at `git pull --ff-only` | Someone edited files on the VM. Run `git status` there; keep the VM checkout clean (`.env` is ignored by git) |
| `docker compose up` says port 80 is in use | Something else listens on 80. Stop it, or set `NGINX_HOST_PORT` in `.env` |
| After scaling, some requests fail for a few seconds | Normal: Nginx re-reads the replica list every 10 seconds |
