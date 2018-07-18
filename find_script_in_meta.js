#!/usr/bin/env nodejs

// USAGE: ./find_script_in_meta.js [--name="My script"]

'use strict';

var args = {};

const fs = require('fs');
const upath = require('upath');
const config = 'config.json';
const glob = require( 'glob' );

if (fs.existsSync(config)) {
    args = JSON.parse(fs.readFileSync(config));
}

[ 'username', 'password' ].forEach(function(k) { args[k] = args[k] || process.env['TD_' + k.toUpperCase()]; });

process.argv.forEach(function(val/*, index, array*/) {
    var s = val.replace(/^[-]{1,2}/, '').split('=');
    args[s[0]] = s[1] || true;
});

const error = function(m) {
    console.error(m);
};

if (!args.path) {
    return error('path argument missing');
}

const working_dir = upath.join('./', args.path);
if (!fs.existsSync(working_dir)) {
    return error('working directory missing');
}

glob.sync(`${upath.join('./', working_dir)}/**/*.meta.json`).forEach(function(file) {
    var c = fs.readFileSync(file);
    var json;
    try {
        json = JSON.parse(c);
    } catch (e) {}
    if (json) {
        if (args.name && json.name !== args.name) {
            return;
        } else {
            console.log(`${file} => ${json.name}`);
        }
    }
});
