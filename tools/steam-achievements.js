// Prints every achievement so you can create them in Steamworks (Stats & Achievements).
// API Name must match exactly. Usage: node tools/steam-achievements.js
const { ACHIEVEMENTS } = require('../shared/meta');
console.log('API Name'.padEnd(20), 'Display Name'.padEnd(26), 'Hidden', ' Description');
for (const a of ACHIEVEMENTS) console.log(a.id.padEnd(20), a.name.padEnd(26), (a.hidden ? 'yes' : 'no').padEnd(6), '', a.desc);
console.log(`\n${ACHIEVEMENTS.length} achievements`);
