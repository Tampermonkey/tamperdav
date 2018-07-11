#!/bin/bash

npm install
mkdir dav 2>/dev/null

cat > config.json <<EOL
{
    "path": "dav",
    "metatouch": true,
    "open-in-editor": true
}
EOL

node server.js
