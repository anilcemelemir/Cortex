# Sunucuyu İnternete Açma (VPS + TURN)

Arkadaşlarınla kullanmak için backend'i (hesaplar + sunucular/kanallar + text +
WebRTC signaling) bir VPS'e kurar, HTTPS/WSS ile yayınlar ve aynı kutuda bir
TURN sunucusu çalıştırırsın. **Ses/görüntü yine doğrudan P2P akar** — sunucu
sadece buluşma + text + hesap işidir, ping'i etkilemez.

## 1) VPS al

- **Öneri:** [Hetzner](https://www.hetzner.com/cloud) **CX22** (~€4/ay), Ubuntu 24.04.
  (Alternatif: Contabo, DigitalOcean, Vultr.)
- Konum fark etmez (medya P2P). Almanya/Finlandiya ucuz ve stabil.

## 2) Alan adı (domain) bağla

- Bir alan adı al (Cloudflare/Namecheap vb.) ya da bir alt alan ayır.
- **A kaydı** oluştur: `sesli.senin-domain.com  →  VPS_IP_ADRESI`
- WSS (TLS) için alan adı şart; Caddy sertifikayı otomatik alır.

## 3) Sunucuya bağlan ve Docker kur

```bash
ssh root@VPS_IP
apt update && apt install -y docker.io docker-compose-plugin git
```

## 4) Projeyi kopyala

`server/`, `docker-compose.yml`, `Caddyfile`, `turnserver.conf` dosyalarını
sunucuya taşı (git ile ya da `scp`). Örn:

```bash
git clone <repo-adresin> sesli && cd sesli
# ya da yerelden: scp -r DiscordClone root@VPS_IP:/root/sesli
```

## 5) Ayarları düzenle

- **`Caddyfile`** → `sesli.ornek-domain.com` yerine kendi alan adını yaz.
- **`turnserver.conf`** → `realm` = alan adın, `user=...` satırındaki şifreyi değiştir.
- **`.env`** dosyası oluştur (JWT imza anahtarı):

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
```

## 6) Firewall portlarını aç

```bash
ufw allow 22/tcp        # SSH
ufw allow 80,443/tcp    # HTTP/HTTPS (Caddy)
ufw allow 3478/udp      # TURN
ufw allow 3478/tcp
ufw allow 49160:49200/udp  # TURN relay aralığı
ufw enable
```

## 7) Başlat

```bash
docker compose up -d --build
docker compose logs -f app   # "Sunucu ... çalışıyor" görmelisin
```

Test: tarayıcıda `https://sesli.senin-domain.com/health` → `{"ok":true}`.

## 8) Client'ı sunucuya yönlendir

`client/renderer/config.js` içinde:

```js
defaultServer: 'wss://sesli.senin-domain.com',

iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:sesli.senin-domain.com:3478',
    username: 'turnkullanici',
    credential: 'turnserver.conf-deki-sifre',
  },
],
```

> Not: Kullanıcılar giriş ekranındaki **Gelişmiş → Sunucu adresi** alanından da
> sunucuyu değiştirebilir; ama TURN'u config'e gömmen en sağlamı.

## 9) `.exe`'yi yeniden üret ve paylaş

```bash
cd client
npm run dist
```

`client/dist/Cortex-Kurulum-*.exe` dosyasını arkadaşlarına gönder. Çift
tıklayıp kurarlar, hesap açıp senin sunucu adresinle giriş yaparlar.

---

### Sorun giderme

- **Bağlanamıyor / WSS hatası:** DNS A kaydı doğru mu, 443 açık mı, Caddy
  sertifika aldı mı (`docker compose logs caddy`)?
- **Ses kuruluyor ama duyulmuyor (bazı kişilerde):** TURN devrede mi? `coturn`
  loglarına bak, relay portları (49160-49200/udp) firewall'da açık mı?
- **Verileri yedekle:** Tüm durum `app-data` Docker volume'unda (SQLite). 
  `docker run --rm -v sesli_app-data:/d -v $PWD:/b alpine tar czf /b/yedek.tgz /d`
