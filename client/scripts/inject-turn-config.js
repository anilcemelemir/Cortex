const fs = require('fs');
const path = require('path');

const credential = process.env.CORTEX_TURN_CREDENTIAL;
if (!credential) {
  console.log('CORTEX_TURN_CREDENTIAL yok; TURN eklenmeden devam ediliyor.');
  process.exit(0);
}

const turnUrl = process.env.CORTEX_TURN_URL || 'turn:cortexapp.web.tr:3478';
const username = process.env.CORTEX_TURN_USERNAME || 'turnkullanici';
const configPath = path.join(__dirname, '..', 'renderer', 'config.js');
const source = fs.readFileSync(configPath, 'utf8');

const marker = "    // Release build sirasinda GitHub Secret ile TURN eklenir.\n    // Public repo'ya gercek TURN sifresi commit etme.";
const turnBlock = `    {\n      urls: ${JSON.stringify(turnUrl)},\n      username: ${JSON.stringify(username)},\n      credential: ${JSON.stringify(credential)},\n    },`;

if (!source.includes(marker)) {
  throw new Error('TURN injection marker bulunamadi.');
}

fs.writeFileSync(configPath, source.replace(marker, turnBlock));
console.log(`TURN config eklendi: ${turnUrl} / ${username}`);
