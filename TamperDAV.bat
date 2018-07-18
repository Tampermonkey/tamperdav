call npm install

mkdir dav
(
  echo {
  echo "path": "dav",
  echo "meta-touch": true,
  echo "open-in-editor": true
  echo }
) > config.json

node server.js
