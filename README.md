<p align="center"><img src="bitlink21-128.png" width="96" alt="BitLink21"></p>

<h1 align="center">BitLink21</h1>

<p align="center"><b>Bitcoin over the QO-100 satellite. No internet between stations.</b></p>

BitLink21 sends text messages, files, signed Bitcoin transactions and Lightning
invoices through the QO-100 geostationary amateur satellite using a PlutoSDR.
Type a channel frequency, press **Send**, and BitLink21 does the radio work:

- **Locks to the QO-100 beacon** to cancel LNB drift, live, with no manual tuning
- **Tunes uplink and downlink** from one frequency, using the QO-100 band plan
- **Confirms delivery** by hearing your own transmission back through the satellite,
  and corrects your uplink frequency from that echo
- **Relays Bitcoin**: a receiving station can broadcast a received transaction
  through its own node





## Install

### Umbrel

1. Open the **App Store**, then **⋯ → Community App Stores**.
2. Add `https://github.com/CryptoIceMLH/BitLink21` and open the **CryptoIce** store.
3. Install **BitLink21**.

### Linux (standalone Docker, no Umbrel)

BitLink21 runs as one Docker container on any 64-bit (amd64 / x86-64) Linux
machine, VM or LXC: Ubuntu, Debian, Proxmox and so on.

**Requirements**

- Docker Engine with the Compose plugin
  ([install guide](https://docs.docker.com/engine/install/)); check with
  `docker compose version`
- Disk: 10 GB free to use the ready-made image, 25 GB free to build it yourself
- 2+ CPU cores and 4 GB RAM
- The Pluto reachable from this machine (test with `ping 192.168.2.1`, or your
  Pluto's address)

**1. Get the files**

```bash
git clone https://github.com/CryptoIceMLH/BitLink21.git
cd BitLink21
cp .env.example .env
```

Edit `.env` and set `PLUTO_URI` to your Pluto, for example `ip:192.168.2.1`
(the Pluto default) or `ip:192.168.1.200`. You can also change it later in the
app's setup. `BITLINK21_PORT` sets the web port (default 7000).

**2a. Run the ready-made image** (recommended)

```bash
docker compose up -d
```

This downloads `ghcr.io/cryptoicemlh/bitlink21` (about 7 GB) and starts it.

**2b. Or build the image yourself** (about an hour)

```bash
docker compose build
docker compose up -d
```

This compiles the full SDR stack (GNU Radio, gr-satellites, SatDump and more)
from the `Dockerfile`. Use it if you changed the code or want to verify the image.

**3. Open the app**

Browse to `http://<machine-ip>:7000` and complete the short setup.

**Everyday commands**

| | |
|---|---|
| Logs | `docker compose logs -f` |
| Stop / start | `docker compose stop` / `docker compose start` |
| Update | `git pull && docker compose pull && docker compose up -d` |
| Update (self-built) | `git pull && docker compose build && docker compose up -d` |
| Remove | `docker compose down` (your data stays in `./data`) |

Messages, settings and received files are stored in `./data` next to the
compose file; back up that folder to keep them.

Only one program can use the Pluto at a time. Stop SDR++, GQRX or another
BitLink21 instance before starting the radio here.

## First run

A short setup asks for your callsign, LNB LO frequency and Pluto address, and
whether to enable transmit. After
that, opening the **Link** page starts the radio, locks the beacon and shows when
the channel is ready. Enter a channel frequency (for example `10489.750`), pick a
speed and send.

| Speed | Mode | Rate | Use |
|---|---|---|---|
| Robust | BPSK | 1.2 kbit/s | Small dish or weak signal |
| Standard | QPSK | 3 kbit/s | Good default |
| Fast | QPSK | 4.4 kbit/s | HSModem default |
| Turbo | 8APSK | 7.2 kbit/s | Strong signal |

Messages can be sent in clear or encrypted with a shared passphrase
(AES-256-GCM). Files are always sent in clear so any HSModem station can open them.

**Advanced** shows beacon lock, modem state, frequency plan and calibration. The
classic radio view (waterfall, VFOs, decoders) is under **Radio (classic)**.

## Bitcoin and Lightning

- **Bitcoin TX**: paste a signed raw transaction and send it. A receiving station with
  relay enabled broadcasts it through its Bitcoin Core node (RPC settings on the
  Bitcoin & Lightning page).
- **Lightning**: send a BOLT11 invoice over the air; the receiving side shows the
  amount and can copy it to a wallet.

## Credits

- [Ground Station](https://github.com/sgoudelis/ground-station) by sgoudelis.
  BitLink21 is built on this SDR web application (GPL-3.0).
- [HSModem](https://github.com/dj0abr/SSB_HighSpeed_Modem) by DJ0ABR. BitLink21
  implements its on-air format (GPL-3.0).
- [gr-dvbs2rx](https://github.com/igorauad/gr-dvbs2rx) inspired the
  type-a-frequency, auto-lock receiver.
- AMSAT-DL and the QO-100 community.

## Licence

GPL-3.0, see [LICENSE](LICENSE).
