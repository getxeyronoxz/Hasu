const p = require('path');
const src = '"C:\\Users\\prakh\\Downloads\\ad8d486647d64b5eb01616476a939574_obj.zip"';
const cleaned = src.trim().replace(/^["']|["']$/g, '');
console.log('original:', src);
console.log('cleaned:', cleaned);
console.log('isAbsolute:', p.isAbsolute(cleaned));
