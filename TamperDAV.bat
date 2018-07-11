call npm install

mkdir dav
(
  echo {
  echo "path": "dav",
  echo "metatouch": true,
  echo "open-in-editor": true
  echo }
) > config.json

node server.js
