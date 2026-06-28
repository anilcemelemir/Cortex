# Cortex Canliya Alim Rehberi

Bu dosya `cortexapp.web.tr` domaini ve Ubuntu VPS uzerinde Cortex'i canliya almak icin adim adim takip listesidir.

Takildigin yerde bana sadece adim numarasini ve aldigin hata/ciktiyi gonder:

```text
Adim 6.3'te kaldim, cikan hata bu: ...
```

## 0. Mevcut Durum

Repository:

```text
https://github.com/anilcemelemir/Cortex
```

Client canli endpoint:

```text
wss://cortexapp.web.tr
```

Client tarafinda kullanici sunucu adresini elle secmez. Kurulum dosyasindan gelen uygulama kod icindeki endpoint'e baglanir.

## 1. Satin Alma Kontrol Listesi

### 1.1 Domain

Almayi planladigin domain:

```text
cortexapp.web.tr
```

Domain alindiktan sonra DNS paneline su kaydi gireceksin:

```text
Tip   Ad
A     @       VPS_IP_ADRESI
```

Panel `@` kabul etmiyorsa:

```text
Tip   Ad
A     cortexapp.web.tr       VPS_IP_ADRESI
```

Opsiyonel ama faydali:

```text
Tip   Ad
A     www       VPS_IP_ADRESI
```

Ilk kurulumda `turn.cortexapp.web.tr` sart degil; TURN icin de `cortexapp.web.tr:3478` kullanacagiz.

### 1.2 VPS

Hostindunyam paket:

```text
TR-VPS4
3 CPU
4 GB RAM
40 GB SSD
1 Gbit port
```

Bu proje icin baslangicta yeterli. Medya normalde P2P akar; sadece TURN fallback devreye girerse medya trafigi VPS uzerinden gecer.

Isletim sistemi secimi:

```text
Ubuntu 24.04 LTS
```

VPS satin alindiktan sonra elinde sunlar olacak:

```text
VPS_IP_ADRESI
root sifresi veya SSH bilgisi
```

## 2. DNS Ayari

Domain panelinde `cortexapp.web.tr` icin A kaydi olustur:

```text
cortexapp.web.tr -> VPS_IP_ADRESI
```

DNS yayilimini kontrol etmek icin kendi bilgisayarinda:

```powershell
nslookup cortexapp.web.tr
```

Beklenen: VPS IP adresini gormek.

Alternatif:

```powershell
Resolve-DnsName cortexapp.web.tr
```

DNS hemen oturmayabilir. Bazen 5-30 dakika, nadiren daha uzun surebilir.

## 3. VPS'e Ilk Giris

Kendi bilgisayarindan:

```bash
ssh root@VPS_IP_ADRESI
```

Windows PowerShell icinden de calisir:

```powershell
ssh root@VPS_IP_ADRESI
```

Baglandiktan sonra sistem bilgisi:

```bash
lsb_release -a
whoami
pwd
```

Beklenen:

```text
Ubuntu 24.04
root
/root
```

## 4. Temel Paketleri Kur

VPS uzerinde:

```bash
apt update
apt upgrade -y
apt install -y docker.io docker-compose-plugin git openssl ufw curl nano
systemctl enable --now docker
```

Docker kontrol:

```bash
docker --version
docker compose version
systemctl status docker --no-pager
```

Beklenen: Docker aktif gorunmeli.

## 5. Firewall Ayari

VPS uzerinde:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 49160:49200/udp
ufw enable
ufw status verbose
```

Onemli portlar:

```text
22/tcp          SSH
80/tcp          HTTP, Caddy sertifika alma
443/tcp         HTTPS/WSS
3478/tcp+udp    TURN
49160-49200/udp TURN relay araligi
```

Hostindunyam panelinde ekstra firewall varsa ayni portlari panelden de ac.

## 6. Repoyu VPS'e Cek

VPS uzerinde:

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/anilcemelemir/Cortex.git cortex
cd cortex
```

Kontrol:

```bash
git status
git log --oneline -3
ls -la
```

Beklenen: `docker-compose.yml`, `server`, `client`, `Caddyfile`, `turnserver.conf` gorunmeli.

## 7. Gizli Degerleri Olustur

### 7.1 Backend JWT secret

VPS uzerinde:

```bash
cp .env.example .env
sed -i "s/change-this-with-openssl-rand-hex-32/$(openssl rand -hex 32)/" .env
cat .env
```

Beklenen:

```text
JWT_SECRET=uzun-rastgele-bir-deger
```

Bu dosya git'e commit edilmez.

### 7.2 TURN sifresi olustur

VPS uzerinde:

```bash
openssl rand -base64 32
```

Cikan degeri sakla. Asagida `TURN_SIFRESI` yerine bunu kullanacaksin.

## 8. Caddy Domain Ayari

VPS uzerinde:

```bash
nano Caddyfile
```

Dosyayi su hale getir:

```caddyfile
cortexapp.web.tr {
    reverse_proxy app:8080
}
```

Kaydet:

```text
CTRL+O
Enter
CTRL+X
```

Istersen `www` de calissin:

```caddyfile
cortexapp.web.tr, www.cortexapp.web.tr {
    reverse_proxy app:8080
}
```

Bu durumda DNS'te `www` A kaydi da olmalidir.

## 9. TURN Ayari

VPS uzerinde:

```bash
nano turnserver.conf
```

Su satirlari duzenle:

```text
user=turnkullanici:TURN_SIFRESI
realm=cortexapp.web.tr
```

Bazi VPS saglayicilarinda public IP'yi acik yazmak gerekebilir. Ilk denemede yorumda kalabilir:

```text
# external-ip=VPS_IP_ADRESI
```

Ses/ekran paylasimi bazi aglarda calismazsa bu satiri ac:

```text
external-ip=VPS_IP_ADRESI
```

## 10. Docker Compose Config Kontrolu

VPS uzerinde:

```bash
docker compose config
```

Hata olmamali. Cikti uzun olabilir; bu normal.

## 11. Servisleri Baslat

VPS uzerinde:

```bash
docker compose up -d --build
```

Durum kontrol:

```bash
docker compose ps
```

Beklenen servisler:

```text
app
caddy
coturn
```

Loglar:

```bash
docker compose logs -f app
```

Beklenen:

```text
Sunucu http://localhost:8080 uzerinde calisiyor
```

Caddy log:

```bash
docker compose logs -f caddy
```

Ilk calismada Caddy Let's Encrypt sertifikasi almaya calisir. DNS dogru degilse burada hata gorursun.

## 12. Saglik Kontrolleri

VPS icinden:

```bash
curl http://localhost:8080/health
```

Beklenen:

```json
{"ok":true}
```

Dis dunyadan HTTPS:

```bash
curl https://cortexapp.web.tr/health
```

Beklenen:

```json
{"ok":true}
```

Kendi bilgisayarindan PowerShell:

```powershell
Invoke-WebRequest https://cortexapp.web.tr/health -UseBasicParsing
```

## 13. Client TURN Bilgisini Ayarla

Public repo'ya gercek TURN sifresi commit etme.

Installer uretmeden once lokal bilgisayarinda su dosyayi ac:

```text
client/renderer/config.js
```

`iceServers` kismini su sekilde doldur:

```js
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:cortexapp.web.tr:3478',
    username: 'turnkullanici',
    credential: 'TURN_SIFRESI',
  },
],
```

`defaultServer` zaten sunu gostermeli:

```js
defaultServer: 'wss://cortexapp.web.tr',
allowCustomServer: false,
```

Onemli: TURN sifresi client icine girerse teknik olarak kullanicinin bilgisayarindan okunabilir. Kucuk arkadas grubu icin kabul edilebilir; daha profesyonel kullanimda kisa omurlu TURN credential uretecek bir backend endpoint'i yapmak gerekir.

## 14. Windows Installer Uret

Kendi bilgisayarinda proje klasorunde:

```powershell
cd client
npm install
npm run dist
```

Cikti:

```text
client/dist/Cortex-Kurulum-1.0.0.exe
```

Bu dosyayi kurup test et.

## 15. Ilk Canli Test Senaryosu

En az 2 kullanici ile test et.

### 15.1 Hesap ve sunucu

1. Kullanici A hesap olusturur.
2. Kullanici A bir sunucu olusturur.
3. Davet kodunu Kullanici B'ye verir.
4. Kullanici B hesap olusturur ve davet koduyla sunucuya katilir.

Beklenen:

```text
Sag panelde iki kullanici aktif gorunur.
Offline olanlar cevrimdisi gorunur.
```

### 15.2 Mesaj

1. Text kanalinda A mesaj atar.
2. B mesaj sesi duyar.
3. B cevap yazar.

Beklenen:

```text
Mesajlar anlik gelir.
Dosya eki indirilebilir.
Kod kanalinda kod renklendirilir ve kopyalanir.
```

### 15.3 Ses

1. A ses kanalina girer.
2. B ayni ses kanalina girer.
3. Mikrofon mute/hoparlor mute test edilir.
4. Ayarlar > Ses & Mod ekraninda mikrofon barina bakilir.

Beklenen:

```text
Konusurken ses barinda seviye gorunur.
Aktivasyon esigi slider'i bar uzerindeki cizgiyi oynatir.
Iki taraf birbirini duyar.
```

### 15.4 Kamera

1. A kamera acar.
2. B A'nin kamerasini gorur.
3. B kamera acar.

Beklenen:

```text
Kamera tile icinde gorunur.
Kamera acilinca aksiyon sesi duyulur.
```

### 15.5 Ekran paylasimi

1. A ekran paylasir.
2. B sag panelde A'nin yanindaki Izle butonuna basar.
3. B ayni ses kanalina girer ve ekran tile'ini gorur.

Beklenen:

```text
Ekran goruntusu gelir.
Yayin acilinca aksiyon sesi duyulur.
```

## 16. GitHub Actions CI/CD Ayari

GitHub repo:

```text
https://github.com/anilcemelemir/Cortex
```

Repo > Settings > Secrets and variables > Actions > Secrets:

```text
VPS_HOST=VPS_IP_ADRESI
VPS_USER=root
VPS_APP_DIR=/opt/cortex
VPS_SSH_KEY=private SSH key icerigi
```

SSH key olusturmak icin kendi bilgisayarinda:

```bash
ssh-keygen -t ed25519 -C "cortex-deploy" -f ~/.ssh/cortex_deploy
```

Public key'i VPS'e ekle:

```bash
ssh-copy-id -i ~/.ssh/cortex_deploy.pub root@VPS_IP_ADRESI
```

Windows'ta `ssh-copy-id` yoksa:

```powershell
type $env:USERPROFILE\.ssh\cortex_deploy.pub
```

Ciktisini kopyala. VPS'te:

```bash
mkdir -p ~/.ssh
nano ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

Private key'i GitHub secret'a koy:

```bash
cat ~/.ssh/cortex_deploy
```

Windows PowerShell:

```powershell
Get-Content $env:USERPROFILE\.ssh\cortex_deploy
```

GitHub Actions > Deploy VPS > Run workflow ile manuel deploy calistir.

Otomatik deploy istersen Repo > Settings > Secrets and variables > Actions > Variables:

```text
AUTO_DEPLOY=true
```

Ilk kurulumda otomatik deploy'u kapali tutmak daha kontrollu.

## 17. Guncelleme Akisi

Kod degisikligi sonrasi:

```bash
git add .
git commit -m "Degisiklik aciklamasi"
git push
```

VPS'te manuel guncelleme:

```bash
cd /opt/cortex
git pull
docker compose up -d --build
```

Client degistiyse yeniden installer uret:

```powershell
cd client
npm run dist
```

## 18. Yedek Alma

Backend verisi Docker volume icinde tutulur.

VPS uzerinde:

```bash
cd /opt/cortex
docker run --rm \
  -v cortex_app-data:/data \
  -v "$PWD:/backup" \
  alpine tar czf /backup/cortex-data-backup.tgz /data
```

Yedek dosyasi:

```text
/opt/cortex/cortex-data-backup.tgz
```

## 19. Sorun Giderme

### 19.1 Domain yanit vermiyor

```bash
nslookup cortexapp.web.tr
docker compose logs caddy
```

Kontrol:

```text
DNS A kaydi VPS IP'ye gidiyor mu?
80 ve 443 acik mi?
Caddy sertifika alabilmis mi?
```

### 19.2 Backend calismiyor

```bash
docker compose ps
docker compose logs app
cat .env
```

Kontrol:

```text
JWT_SECRET dolu mu?
server container restart loop'a giriyor mu?
```

### 19.3 Ses veya ekran paylasimi bazi kisilerde calismiyor

```bash
docker compose logs coturn
ufw status verbose
```

Kontrol:

```text
3478/tcp acik mi?
3478/udp acik mi?
49160:49200/udp acik mi?
turnserver.conf realm dogru mu?
client config icindeki TURN sifresi dogru mu?
```

Gerekirse `turnserver.conf` icinde:

```text
external-ip=VPS_IP_ADRESI
```

satirini aktif et ve yeniden baslat:

```bash
docker compose restart coturn
```

### 19.4 Client hala localhost'a baglanmaya calisiyor

Kontrol edilecek dosya:

```text
client/renderer/config.js
```

Beklenen:

```js
defaultServer: 'wss://cortexapp.web.tr',
allowCustomServer: false,
```

Eski installer kurulmus olabilir. Yeni installer uretip tekrar kur.

## 20. Bana Gonderecegin Bilgiler

Takildiginda su format iyi olur:

```text
Adim: 11
Komut: docker compose up -d --build
Hata/Cikti:
...
Domain: cortexapp.web.tr
VPS IP: x.x.x.x
```

Gizli bilgileri gonderme:

```text
JWT_SECRET
TURN_SIFRESI
SSH private key
GitHub secret degerleri
```

