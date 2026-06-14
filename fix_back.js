const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.js')) results.push(file);
    }
  });
  return results;
}

const files = walk('api');
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  const oldContent = content;
  
  const depth = f.split(path.sep).length - 1; // e.g. api, events.js -> 2 - 1 = 1. api, events, create.js -> 3 - 1 = 2.
  
  if (depth === 1) {
    content = content.replace(/from '\.\.\/\.\.\/lib\/db\.js'/g, "from '../lib/db.js'");
  } else if (depth === 2) {
    content = content.replace(/from '\.\.\/\.\.\/\.\.\/lib\/db\.js'/g, "from '../../lib/db.js'");
  }
  
  if (content !== oldContent) {
    fs.writeFileSync(f, content);
    console.log('Fixed back:', f);
  }
});
