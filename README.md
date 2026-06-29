# Cortex

Cortex, arkadaş grupları için geliştirilmiş açık kaynaklı bir masaüstü sesli/görüntülü sohbet uygulamasıdır. Discord'un ülkemizde erişim sorunu yaşadığı dönemlerde arkadaşlarımla aynı yerde toplanabilmek, oyun oynarken konuşabilmek, ekran paylaşabilmek ve küçük sunucular kurabilmek için yaptım.

İsteyen herkes projeyi alıp kendi sunucusunda çalıştırabilir, değiştirebilir ve geliştirebilir. Proje MIT lisanslıdır.

> Cortex resmi bir Discord istemcisi değildir. Kendi backend'i, kendi Electron istemcisi ve WebRTC tabanlı P2P medya bağlantısı olan bağımsız bir uygulamadır.

## Özellikler

- Electron masaüstü uygulaması
- Hesap oluşturma ve giriş
- Sunucu oluşturma, davet koduyla katılma
- Text, ses ve kod paylaşım kanalları
- Dosya paylaşımı
- Kod kanalında renklendirme ve hızlı kopyalama
- Ses, mikrofon, kamera ve ekran paylaşımı
- Sağ panelde aktif/çevrimdışı kullanıcılar
- Sunucu sahibi için sunucu ve kanal yönetimi
- Profil fotoğrafı ve sunucu fotoğrafı
- Oyun/Spotify aktivite durumu
- Aksiyon sesleri
- VPS üzerinde Docker Compose ile backend, HTTPS/WSS ve TURN kurulumu

## Mimari

- `client/`: Electron istemcisi
- `server/`: Node.js REST API + WebSocket realtime gateway
- `assets/`: uygulama ikonu ve görsel varlıklar
- `docker-compose.yml`: VPS üzerinde backend + Caddy + coturn
- `Caddyfile`: HTTPS/WSS reverse proxy
- `turnserver.conf`: WebRTC için TURN fallback sunucusu

Medya akışı WebRTC ile kullanıcılar arasında P2P gider. Backend hesap, sunucu, kanal, mesaj, presence ve WebRTC signaling işlerini yapar. Bazı ağlarda P2P doğrudan kurulamaz; gerçek kullanım için TURN önerilir.

## İndirme

Canlı kurulum sayfası:

```text
https://cortexapp.web.tr/indir
```

Doğrudan son Windows kurulum dosyası:

```text
https://github.com/anilcemelemir/Cortex/releases/latest/download/Cortex-Kurulum.exe
```

Kurulum dosyaları GitHub Releases üzerinde yayınlanır; domain üzerindeki indirme sayfası her zaman son sürüme yönlenir.

## Yerelde Çalıştırma

Gerekenler:

- Node.js 24+
- npm
- Windows üzerinde Electron client

Backend:

```bash
cd server
npm install
npm start
```

Backend varsayılan olarak `http://localhost:8080` ve `ws://localhost:8080/ws` üzerinde çalışır.

Client:

```bash
cd client
npm install
npm start
```

Kurulum dosyası üretmek için:

```bash
cd client
npm run dist
```

Windows installer çıktısı `client/dist/` altında oluşur.

## VPS'e Kurulum

Bu bölüm Ubuntu 24.04 kurulu bir VPS varsayar.

### 1. VPS Al

Hetzner, Contabo, DigitalOcean, Vultr veya benzeri bir sağlayıcıdan küçük bir Ubuntu VPS yeterlidir. Medya P2P aktığı için backend çok ağır değildir; ancak TURN devreye girdiğinde trafik VPS üzerinden geçebilir.

### 2. Domain Bağla

Bir domain veya subdomain ayır:

```text
cortex.ornek-domain.com -> VPS_IP_ADRESI
```

DNS tarafında `A` kaydı VPS IP adresini göstermelidir.

### 3. Sunucuya Bağlan

```bash
ssh root@VPS_IP_ADRESI
```

Docker, Compose ve git kur:

```bash
apt update
apt install -y docker.io docker-compose-plugin git openssl
systemctl enable --now docker
```

### 4. Repoyu Çek

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/anilcemelemir/Cortex.git cortex
cd cortex
```

### 5. Ortam Değişkenini Oluştur

```bash
cp .env.example .env
sed -i "s/change-this-with-openssl-rand-hex-32/$(openssl rand -hex 32)/" .env
```

### 6. Domain ve TURN Ayarlarını Düzenle

`Caddyfile` içindeki örnek domaini kendi domaininle değiştir:

```caddyfile
cortex.ornek-domain.com {
    reverse_proxy app:8080
}
```

`turnserver.conf` içinde şunları değiştir:

```text
user=turnkullanici:COK-GUCLU-BIR-SIFRE
realm=cortex.ornek-domain.com
```

Bazı VPS sağlayıcılarında `external-ip=VPS_IP_ADRESI` satırını da açman gerekebilir.

### 7. Firewall Portlarını Aç

Ubuntu UFW kullanıyorsan:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 49160:49200/udp
ufw enable
```

Sağlayıcının panelinde ayrıca firewall varsa aynı portları orada da aç.

### 8. Servisleri Başlat

```bash
docker compose up -d --build
docker compose logs -f app
```

Sağlık kontrolü:

```bash
curl https://cortex.ornek-domain.com/health
```

Beklenen cevap:

```json
{"ok":true}
```

### 9. Client'ı Kendi Sunucuna Yönlendir

Canlı kurulum dosyasında kullanıcı sunucuyu elle seçmez; client doğrudan `client/renderer/config.js` içindeki endpoint'e bağlanır. Varsayılan sunucuyu kendi domaininle değiştir:

```js
defaultServer: 'wss://cortexapp.web.tr',
allowCustomServer: false,
```

TURN'u da ekle:

```js
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:cortexapp.web.tr:3478',
    username: 'turnkullanici',
    credential: 'COK-GUCLU-BIR-SIFRE',
  },
],
```

Sonra installer üret:

```bash
cd client
npm install
npm run dist
```

Arkadaşlarına `client/dist/Cortex-Kurulum-*.exe` dosyasını gönderebilirsin.

Gerçek TURN şifresini public repoya commit etme. Bu değer installer üretmeden önce kendi lokal build'inde veya özel CI/CD secret akışında verilmelidir.

## CI/CD

Bu repoda iki GitHub Actions workflow'u var:

- `CI`: Her push ve pull request'te bağımlılıkları kurar, JavaScript sözdizimini kontrol eder ve Docker Compose yapılandırmasını doğrular.
- `Deploy VPS`: Manuel çalıştırılabilir. İstersen `AUTO_DEPLOY=true` repo değişkeniyle `main` branch pushlarında otomatik deploy eder.

GitHub repository ayarlarında şu secret'ları ekle:

```text
VPS_HOST=VPS_IP_ADRESI veya domain
VPS_USER=root
VPS_SSH_KEY=private SSH key içeriği
VPS_APP_DIR=/opt/cortex
```

Otomatik deploy için ayrıca repository variable ekle:

```text
AUTO_DEPLOY=true
```

SSH key hazırlama örneği:

```bash
ssh-keygen -t ed25519 -C "cortex-deploy" -f ~/.ssh/cortex_deploy
ssh-copy-id -i ~/.ssh/cortex_deploy.pub root@VPS_IP_ADRESI
cat ~/.ssh/cortex_deploy
```

`cat` çıktısını `VPS_SSH_KEY` secret'ına koy.

Deploy workflow'u VPS'e SSH ile girer, repoyu `/opt/cortex` altına çeker, `main` branch'e resetler ve:

```bash
docker compose up -d --build
```

komutunu çalıştırır.

## Güncelleme

VPS üzerinde manuel güncelleme:

```bash
cd /opt/cortex
git pull
docker compose up -d --build
```

Client değiştiyse yeni installer üretip paylaş:

```bash
cd client
npm run dist
```

## Verileri Yedekleme

Backend verisi Docker volume içinde tutulur. Yedek almak için:

```bash
docker run --rm \
  -v cortex_app-data:/data \
  -v "$PWD:/backup" \
  alpine tar czf /backup/cortex-data-backup.tgz /data
```

Geri yükleme yapmadan önce servisleri durdur:

```bash
docker compose down
```

## Sorun Giderme

WSS bağlanmıyorsa:

```bash
docker compose logs caddy
```

Domain A kaydı doğru mu, 80/443 açık mı kontrol et.

Ses veya ekran paylaşımı bazı kişilerde çalışmıyorsa:

- TURN bilgileri `turnserver.conf` ve `client/renderer/config.js` içinde aynı mı?
- 3478 TCP/UDP açık mı?
- 49160-49200 UDP açık mı?
- VPS sağlayıcısının güvenlik duvarı da açık mı?

Backend logları:

```bash
docker compose logs -f app
```

TURN logları:

```bash
docker compose logs -f coturn
```

## Katkı

Issue, fork ve pull request'lere açık. Küçük arkadaş gruplarının kendi iletişim alanını kurabilmesi için yapılan bir proje; isteyen alıp kendi ihtiyacına göre şekillendirebilir.
