if exist config.json goto skip_setup

call npm install

mkdir dav
(
  echo {
  echo "path": "dav",
  echo "meta-touch": true,
  echo "open-in-editor": true
  echo }
) > config.json
:skip_setup

node server.js
