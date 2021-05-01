#!/bin/bash

scriptpath=$(dirname "$(realpath "$0")")

cd $scriptpath

if [ ! -e "config.json" ]
then
    npm install
    mkdir dav 2>/dev/null

    cat > config.json <<EOL
{
    "path": "dav",
    "meta-touch": true,
    "open-in-editor": true
}
EOL
fi

node server.js
