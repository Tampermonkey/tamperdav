TamperDAV
=============

A WebDAV-like server to sync Tampermonkey scripts and edit them with an external editor.

**WARNING:** this is not a 100% WebDAV-compliant server. Many clients should, but don't necessarily have to work!


# Usage

Make sure [Node.js](https://nodejs.org/) greater than v4.9 is installed.

## Windows

execute ```TamperDAV.bat```

## Linux

``` sh
$ ./tamperdav.sh
```


# Clients

## Tampermonkey (4.7.5823+)

![alt text](https://user-images.githubusercontent.com/767504/42598819-a1fb04a0-855d-11e8-8b42-a86abf577d82.png)

Notes:
 * in order to allow Tampermonkey to use the full TamperDAV feature set, please make sure TamperDAV is **running** when Tampermonkey is started.
 * Tampermonkey will sync all scripts into a subfolder of the configured dav-directory i.e. ```Tampermonkey/sync``` using it's internally generated UUID for the filename. The actual file to edit can easily be found by running `node find_script_in_meta.js --name="My Script Name"`. Alternatively you can find the the UUID via Tampermonkey's UI by navigating to the script and retrieving it from the address bar.

## mount

``` sh
sudo mount -t davfs http://localhost:7000 /mnt
```

## nautilus

``` dav://localhost:7000/ ```


# Development

``` sh
# Install dependencies
$ npm install

# run
$ mkdir dav
$ node server.js --path=dav/
```


# Config

All options can be set via config.json and/or command line. ```username``` and ```password``` can be set via environment as well.

## Command Line Example


``` sh
$ TD_USERNAME=derjanb TD_PASSWORD=secret node server.js --path=dav/ --port=6000
```

## Config File Example

```config.json```:
``` json
{
    "path": "dav",
    "no-auth-warning": false,
    "username": "derjanb",
    "password": "secret",
    "port": "7000",
    "host": "localhost",
    "max-cursors": 512,
    "open-in-editor": "sublime_text",
    "meta-touch": true,
    "debug": true
}
```

## All Options

 - ```path``` a relative path from where the files should be served
 - ```no-auth-warning``` don't show a warning if no username and password is set
 - ```username``` username for authentication (basic auth)
 - ```password``` password
 - ```port``` TCP port to listen at
 - ```host``` network address to bind on
 - ```max-cursors``` number of cached changes
 - ```open-in-editor``` if "true" then if Windows "notepad" editor is used, else ```xgd-open```; or the executable as string i.e. "gedit", "notepad", ...
 - ```meta-touch``` touch a sync entries's meta file automatically to make Tampermonkey start a sync on script changes
 - ```debug``` print debug information
