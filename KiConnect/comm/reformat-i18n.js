// normalize-i18n.js
const fs = require('fs');

const inputFile = process.argv[2] || 'kiconnect-languages-i18n.js';
let content = fs.readFileSync(inputFile, 'utf8');

// 1) Tabs → 4 Leerzeichen
content = content.replace(/\t/g, '    ');

// 2) Jede Zeile einzeln verarbeiten
const lines = content.split('\n');
const result = [];

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Prüfen ob Zeile mehrere Key-Value Paare hat
    const pairs = line.match(/('[\w.]+'\s*:\s*'(?:[^'\\]|\\.)*')\s*,?\s*/g);
    
    if (pairs && pairs.length > 1) {
        // Zeile mit mehreren Paaren - aufsplitten mit 4 Leerzeichen Einrückung
        for (let pair of pairs) {
            pair = pair.replace(/,\s*$/, ',');
            // Normalisieren: 4 Leerzeichen Einrückung + genau ein Leerzeichen nach :
            pair = pair.replace(/^(\s*)('[\w.]+')\s*:\s*('[^']*')/, '    $2: $3');
            result.push(pair);
        }
    } else if (line.match(/^\s*'[\w.]+'\s*:\s*'/)) {
        // Einzelne Key-Value Zeile - Einrückung beibehalten, ein Leerzeichen nach :
        line = line.replace(/^(\s*)('[\w.]+')\s*:\s*('[^']*')/, '$1$2: $3');
        result.push(line);
    } else {
        // Andere Zeilen unverändert
        result.push(line);
    }
}

// 3) Ausgabe
const outputFile = inputFile.replace(/\.js$/, '_normalized.js');
fs.writeFileSync(outputFile, result.join('\n'), 'utf8');
console.log(`✅ Normalisierte Datei: ${outputFile}`);