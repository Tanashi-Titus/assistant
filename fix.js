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

const files = walk('pages/api');
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  const oldContent = content;
  
  // Only modify imports matching lib/db.js
  // Depth 1: pages/api/events.js -> needs ../../lib/db.js (was ../lib/db.js)
  // Depth 2: pages/api/events/create.js -> needs ../../../lib/db.js (was ../../lib/db.js)
  
  const depth = f.split(path.sep).length - 2; // e.g. pages, api, events.js -> 3 - 2 = 1. pages, api, events, create.js -> 4 - 2 = 2.
  
  if (depth === 1) {
    content = content.replace(/from '\.\.\/lib\/db\.js'/g, "from '../../lib/db.js'");
  } else if (depth === 2) {
    content = content.replace(/from '\.\.\/\.\.\/lib\/db\.js'/g, "from '../../../lib/db.js'");
  }
  
  if (content !== oldContent) {
    fs.writeFileSync(f, content);
    console.log('Fixed:', f);
  }
});
