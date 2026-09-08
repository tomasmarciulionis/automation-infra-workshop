# Prerequisites

**Please complete this before the workshop, on a good internet connection.**
The downloads total roughly 400 MB. Doing this in the room costs us 15 minutes
of the 60 we have.

When you are done, `npm run doctor` should print all green. That is the only
thing you need to verify.

---

## The short version

Pick your operating system and run one script. Each is safe to re-run and skips
anything you already have.

**macOS**

```bash
git clone <REPO-URL> grid-workshop
cd grid-workshop
bash scripts/preflight-macos.sh
```

**Linux (Debian/Ubuntu or Fedora/RHEL)**

```bash
git clone <REPO-URL> grid-workshop
cd grid-workshop
bash scripts/preflight-linux.sh
```

**Windows (PowerShell)**

```powershell
git clone <REPO-URL> grid-workshop
cd grid-workshop
powershell -ExecutionPolicy Bypass -File scripts\preflight-windows.ps1
```

The script installs Java, Node and Chrome, then runs `npm ci`, `npm run setup`
and `npm run doctor`. If it finishes green, you are done — stop reading here.

If it fails, or your machine is locked down and you need to do this by hand,
read on.

---

## What gets installed, and why

| Thing | Version | Why the workshop needs it |
|---|---|---|
| **Java** | 17 LTS (11 is the floor) | The Selenium Grid hub and every node are Java processes. Nothing else uses Java. |
| **Node.js** | 22 LTS (20 is the floor) | Runs Playwright, the demo app, the metrics exporter and all the workshop scripts. |
| **Google Chrome** | Any recent stable | The Grid nodes drive real Chrome. Playwright's Grid integration only supports Chrome and Edge. |
| **Selenium Server** | 4.48.0 | The Grid itself. A single `.jar` that runs as either a hub or a node. Downloaded into `vendor/` by `npm run setup`. |
| **Playwright** | 1.62.1 | The test runner. Pinned in `package.json`, installed by `npm ci`. |
| **Prometheus** | 3.14.0 | Scrapes Grid metrics so we can see queue depth under load. Downloaded into `vendor/` by `npm run setup`. |
| **Git** | Any | To clone the repo. |

Versions live in one place: [`config/versions.json`](../config/versions.json).
Both `npm run setup` and `npm run doctor` read it, so if you need to change a
version or a port you change it there and nowhere else.

### Why Prometheus and the Selenium jar are downloaded rather than installed

Both are single self-contained binaries with no installer. Pulling them into
`vendor/` means every attendee runs a byte-identical version regardless of
whether their machine has Homebrew, winget, apt or nothing at all. It also
means `rm -rf vendor/` fully uninstalls them.

---

## Manual installation

Only needed if the preflight script did not work for you.

### Java

Java 11 or newer. We test on 17. Selenium dropped Java 8 support in 2023, and
Grid 4.48 needs the Java 11+ built-in HTTP client.

**macOS** — Homebrew's `openjdk` is "keg-only", meaning it is deliberately not
put on your `PATH`. You need the extra symlink step or `java` will appear not to
exist:

```bash
brew install openjdk@17
sudo ln -sfn "$(brew --prefix openjdk@17)/libexec/openjdk.jdk" \
  /Library/Java/JavaVirtualMachines/openjdk-17.jdk
echo 'export PATH="'"$(brew --prefix openjdk@17)"'/bin:$PATH"' >> ~/.zshrc
exec zsh
```

**Windows**

```powershell
winget install --id Microsoft.OpenJDK.17 --accept-package-agreements
```

Then close and reopen PowerShell so it picks up the new `PATH`.

**Debian / Ubuntu**

```bash
sudo apt-get update && sudo apt-get install -y openjdk-17-jdk-headless
```

**Fedora / RHEL**

```bash
sudo dnf install -y java-17-openjdk-headless
```

**Verify:**

```bash
java -version
# openjdk version "17.0.x" ... or any version >= 11
```

### Node.js

Node 20 or newer. We test on 22 LTS.

**macOS**

```bash
brew install node@22
echo 'export PATH="'"$(brew --prefix node@22)"'/bin:$PATH"' >> ~/.zshrc
exec zsh
```

**Windows**

```powershell
winget install --id OpenJS.NodeJS.LTS --accept-package-agreements
```

**Debian / Ubuntu** — the distro package is usually too old, so use NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Fedora / RHEL**

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
sudo dnf install -y nodejs
```

**Already using a version manager?** `nvm`, `fnm` or `volta` are all fine —
just make sure the active version is 20+:

```bash
nvm install 22 && nvm use 22
```

**Verify:**

```bash
node -v   # v22.x.x or newer
npm -v
```

### Google Chrome

**macOS**

```bash
brew install --cask google-chrome
```

**Windows**

```powershell
winget install --id Google.Chrome --accept-package-agreements
```

**Debian / Ubuntu**

```bash
curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y /tmp/chrome.deb
```

**Fedora / RHEL**

```bash
sudo dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
```

Chromium works too. You do **not** need to install `chromedriver` — Selenium
Manager ships inside the Grid jar and downloads a matching driver automatically
the first time a node starts.

### Everything else

```bash
npm ci          # installs Playwright at the pinned version
npm run setup   # downloads the Selenium jar, Prometheus, and Chromium
npm run doctor  # verifies the lot
```

---

## Machine requirements

| | Minimum | Comfortable |
|---|---|---|
| RAM | 8 GB | 16 GB |
| Free disk | 2 GB | 4 GB |
| CPU cores | 4 | 8 |

We run a hub, three nodes and up to three Chrome instances at once on your
laptop. On an 8 GB machine that is tight but works — `npm run doctor` warns you
if you should drop to two nodes, and `docs/SETUP.md` explains how.

### Ports that must be free

`3000`, `4442`, `4443`, `4444`, `5570`, `5571`, `5572`, `9090`, `9615`

`npm run doctor` checks all nine and names anything that is squatting.

We use `5570-5572` for the Grid nodes rather than Selenium's documented default
of `5555`, because `5555` is also the default ADB port — if you have an Android
emulator running, `5555` is already taken. If you hit a conflict anyway, change
`grid.nodePorts` in `config/versions.json`.

---

## Corporate laptop gotchas

Worth checking in advance if your machine is managed, because these are the
failures that cannot be fixed in the room.

- **No admin rights.** Installing Java, Node and Chrome needs them. Everything
  after that does not. Get these three installed ahead of time.
- **HTTP proxy.** `npm run setup` uses `fetch` and respects the standard
  environment variables. Set them before running it:
  ```bash
  export HTTPS_PROXY=http://proxy.corp:8080
  export HTTP_PROXY=http://proxy.corp:8080
  npm config set proxy  http://proxy.corp:8080
  npm config set https-proxy http://proxy.corp:8080
  ```
- **TLS interception.** If downloads fail with certificate errors, point Node at
  your corporate CA bundle: `export NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem`
- **Endpoint protection.** Security agents sometimes quarantine `chromedriver`
  as an unsigned binary, or block one local process from attaching a debugger to
  another — which is exactly what Playwright does. If Chrome starts but tests
  cannot connect, this is the usual culprit. Ask IT to allow the repo directory,
  or pair with someone whose machine is not managed.
- **Firewall prompts on first run.** macOS and Windows will both ask whether
  `java` may accept incoming connections. Say yes — the hub and nodes talk to
  each other over localhost.

---

## Nice to have, not required

- Basic familiarity with Playwright. If you have never written a Playwright
  test, you will still be able to follow along: we read and diagnose far more
  code than we write.
- A rough sense of how your team currently runs its test suite in CI. The last
  ten minutes of the workshop are about mapping what we built onto your setup,
  and that lands better if you already have your own pipeline in mind.

You do **not** need to know Selenium, Java, PromQL or Docker.

---

## If you get stuck

1. Run `npm run doctor` and read the `->` fix hint on each failing line.
2. Check [SETUP.md](./SETUP.md#troubleshooting) for the known failure modes.
3. Message the instructor before the workshop with the `npm run doctor` output
   pasted in. We will sort it out ahead of time rather than during the session.
