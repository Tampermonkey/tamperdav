#!/usr/bin/env nodejs

'use strict';

var args = {};

const fs = require('fs');
const upath = require('upath');
const http = require('http');
const url = require('url');
let dialog = require('dialog');
const crypto = require('crypto');
const chokidar = require('chokidar');
const opn = require('opn');
const config = 'config.json';

if (fs.existsSync(config)) {
    args = JSON.parse(fs.readFileSync(config));
}

if (!process.env['DISPLAY']){
  dialog = console
}

[ 'username', 'password' ].forEach(function(k) { args[k] = args[k] || process.env['TD_' + k.toUpperCase()]; });

process.argv.forEach(function(val/*, index, array*/) {
    var s = val.replace(/^[-]{1,2}/, '').split('=');
    args[s[0]] = s[1] || true;
});

const error = function(m) {
    console.error(m);
    dialog.err(m, 'TamperDAV');
};

global.btoa = function(s) {
    if (typeof Buffer.from === 'function') {
        return Buffer.from(s, 'base64').toString(); // Node 5.10+
    } else {
        return new Buffer(s, 'base64').toString(); // older Node versions
    }
};

if (!args.path) {
    return error('path arguments missing');
}

const working_dir = upath.join('./', args.path);
if (!fs.existsSync(working_dir)) {
    return error('working directory missing');
}

if (!args['no-auth-warning'] && (!args.username || !args.password)) {
    dialog.warn('TamperDAV is running without any form of authentication. It\'s strongly recommended to configure username and password!', 'TamperDAV');
}

RegExp.escape = RegExp.escape || function(s) {
    return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
};

const port = args.port || 7000;
const max_cursors = args['max-cursors'] || 512;
var subscribers = {};

const methods = {
    options: function(uri, request, response) {
        var allowed_methods = [
            'GET', 'HEAD', 'OPTIONS', 'PUT', 'PROPFIND', 'MKCOL', 'DELETE', 'SUBSCRIBE'
        ].concat(args['open-in-editor'] ? [ 'EDITOR' ] : []).join(',');

        response.setHeader('Access-Control-Allow-Methods', allowed_methods);
        response.setHeader('Access-Control-Allow-Credentials','true');
        response.setHeader('Access-Control-Allow-Headers','Authorization,User-Agent,Content-Type,Accept,Origin,X-Requested-With,Cursor');

        response.statusCode = 200;
        response.end();
    },
    propfind: function(uri, request, response) {
        var rpath = uri.pathname;
        var fpath = upath.join(working_dir, rpath);

        if (!fs.existsSync(fpath)) {
            response.statusCode = 404;
            response.end();
            return;
        }

        var xml;
        if (!fs.statSync(fpath).isDirectory()) {
            xml = arrayToXml(rpath, [ '' ]);
        } else {
            var wc = watcherCache[rpath];
            var files, d;
            if (!(d = request.headers.depth) || d > 0) {
                files = fs.readdirSync(fpath);
            }

             xml = arrayToXml(rpath, [ '.' ].concat(files || []), wc && (!d || d > 0) ? wc.current_cursor : undefined);
        }

        response.statusCode = 207;
        response.setHeader('Content-Type', 'application/xml; charset=utf-8');
        response.end(xml);
    },
    mkcol: function(uri, request, response) {
        var rpath = uri.pathname;
        var fpath = upath.join(working_dir, rpath);

        if (fs.existsSync(fpath)){
            response.statusCode = 405;
            response.end('<d:error xmlns:d="DAV:" xmlns:td="http://dav.tampermonkey.net/ns"><td:exception>MethodNotAllowed</td:exception><td:message>The resource you tried to create already exists</td:message></d:error>');
        } else {
            try {
                fs.mkdirSync(fpath);
                return methods.propfind(uri, request, response);
            } catch (e) {
                response.statusCode = 422;
                response.end();
            }
        }
    },
    get: function(uri, request, response) {
        var rpath = uri.pathname;
        var fpath = upath.join(working_dir, rpath);

        if (fs.existsSync(fpath)){
            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/octet-stream');
            response.end(fs.readFileSync(fpath));
        } else {
            response.statusCode = 404;
            response.end();
        }
    },
    editor: function(uri, request, response) {
        var editor = args['open-in-editor'];
        if (!editor) {
            response.statusCode = 501;
            response.end();
            return;
        } else if (editor === true) {
            if (process.platform == 'win32') {
                editor = 'notepad';
            } else {
                editor = undefined;
            }
        }

        var rpath = uri.pathname;
        var fpath = upath.join(working_dir, rpath);

        if (fs.existsSync(fpath)){

            if (process.env['DISPLAY']){
              opn(upath.resolve(fpath), { app: editor });
            }

            response.setHeader('Location', `dav://${request.headers.host}${uri.pathname}`);
            response.statusCode = 302;
            response.end();
        } else {
            response.statusCode = 404;
            response.end();
        }
    },
    put: function(uri, request, response) {
        var rpath = uri.pathname;
        var fpath = upath.join(working_dir, rpath);

        var data = [];
        request.on('data', function (chunk) {
            data.push(chunk);
        });

        request.on('end', function () {
            fs.writeFileSync(fpath, Buffer.concat(data).toString());

            var ts;
            if ((ts = request.headers['x-oc-mtime'])) {
                try {
                    fs.utimesSync(fpath, ts, ts);
                    response.setHeader('X-OC-Mtime', 'accepted');
                } catch (e) {
                    console.error(`setting mtime #{ts} failed`, e.mesage);
                }
            }

            response.statusCode = 200;
            response.end();
        });
    },
    delete: function(uri, request, response) {
        var rpath = uri.pathname;
        var fpath = upath.join(working_dir, rpath);

        try {
            fs.unlinkSync(fpath);
            response.statusCode = 204;
            response.end();
        } catch (e) {
            console.error(`deleting file #{rpath} failed`, e);
            response.statusCode = 404;
            response.end();
        }
    },
    head: function(uri, request, response) {
        var rpath = uri.pathname;
        var fpath = upath.join(working_dir, rpath);

        var done, stats;
        if (fs.existsSync(fpath)){
            try {
                stats = fs.statSync(fpath);
            } catch (e) {
                console.error(`stat file #{rpath} failed`, e);
            }
            if (stats) {
                response.statusCode = 200;
                response.setHeader('Content-Length', stats.size);
                response.setHeader('Content-Type', 'application/octet-stream');
                response.end();
                done = true;
            }
        }
        if (!done) {
            response.statusCode = 404;
            response.end();
        }
    },
    subscribe: function(uri, request, response) {
        var rpath = uri.pathname;
        var fpath = upath.join(working_dir, rpath);

        if (!fs.existsSync(fpath)) {
            response.statusCode = 404;
            response.end();
            return;
        }

        if (!fs.statSync(fpath).isDirectory()) {
            response.statusCode = 400;
            response.end();
            return;
        }

        var id = crypto.randomBytes(16).toString('hex');
        var to = global.setTimeout(function() {
            delete subscribers[rpath][id];

            if (response.finished) return;

            response.statusCode = 204;
            response.end();
        }, 90 * 1000);

        (subscribers[rpath] = subscribers[rpath] || {})[id] = { response: response, to: to };

        assureWatcher(rpath);

        var url_args = getUrlArgs(uri.search || '');
        var from_cursor;
        if ((from_cursor = (url_args.cursor || request.headers.cursor))) {
            sendCachedWatcherChanges(rpath, parseInt(from_cursor, 10));
        }
    }
};

const getUrlArgs = function(url) {
    var c = {};
    var p = url.replace(/^\?/, '');

    var args = p.split('&');
    var pair;

    for (var i=0; i<args.length; i++) {
        pair = args[i].split('=');
        if (pair.length != 2) {
            var p1 = pair[0];
            var p2 = pair.slice(1).join('=');
            pair = [p1, p2];
        }
        c[pair[0]] = decodeURIComponent(pair[1]);
    }

    return c;
};

const arrayToXml = function(rpath, files, cursor) {
    var fpath = upath.join(working_dir, rpath);

    var entries = files.map(function(file) {
        var name = file;
        var cpath = upath.join(fpath, name);

        var stats, dir;
        try {
            stats = fs.statSync(cpath);
            dir = stats.isDirectory();
        } catch (e) {
            stats = {
                mtime: Date.now(),
                size: -1
            };
            dir = false;
        }

        var mtime = new Date(stats.mtimeMs || stats.mtime);
        var size = stats.size;
        var lastmodified = mtime.toGMTString();

        return [
            '<d:response>',
                `<d:href>${upath.join(rpath, name)}</d:href>`,
                '<d:propstat>',
                    '<d:prop>',
                        `<d:getlastmodified>${lastmodified}</d:getlastmodified>`,
                        dir ? '<d:resourcetype><d:collection/></d:resourcetype>' : '<d:resourcetype />',
                        !dir ? `<d:getcontentlength>${size}</d:getcontentlength>` : '<d:getcontentlength />',
                    '</d:prop>',
                    '<d:status>HTTP/1.1 200 OK</d:status>',
                '</d:propstat>',
            '</d:response>',
        ].filter(function(e) { return e; }).join('\n');
    }).join('\n');
    var new_cursor = cursor ? `<td:cursor>${cursor}</td:cursor>` : '';
    return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:td="http://dav.tampermonkey.net/ns">${entries}${new_cursor}</d:multistatus>`;

};

var watchers = {};
const notifySubscribers = function(rpath, changed_files, cursor) {
    var a;

    if ((a = subscribers[rpath])) {
        subscribers[rpath] = {};
        var xml = arrayToXml(rpath, changed_files, cursor);

        Object.keys(a).forEach(function(k) {
            var o = a[k];
            var response = o.response;

            response.statusCode = 207;
            response.setHeader('Content-Type', 'application/xml; charset=utf-8');

            response.end(xml);

            global.clearTimeout(o.to);
        });
    }
};

var watcherCache = {};

const sendCachedWatcherChanges = function(rpath, from_cursor) {
    var wc, cc;
    if (!(wc = watcherCache[rpath])) {
        return;
    }
    for (var i=from_cursor; i<=wc.current_cursor; i++) {
        if ((cc = wc.changes[i])) {
            notifySubscribers(rpath, Object.keys(cc), i+1);
        }
    }

    var k;
    if ((k = Object.keys(wc.changes)) && k.length > max_cursors) {
        var m = wc.current_cursor - max_cursors + 1;
        k.forEach(function(e) {
            if (e < m) delete wc.changes[e];
        });
    }

    return true;
};

const assureWatcher = function(rpath) {
    if (watchers[rpath]) return;

    var fpath = upath.join(working_dir, rpath);
    var onchange, wc;
    var w = chokidar.watch(fpath, {
        ignored: /^\./,
        atomic: true,
        ignoreInitial: true
    });

    w.on('add', (onchange = function(_path) {
        var path = upath.normalize(_path);
        var cc;
        var filename = path.replace(new RegExp('^' + RegExp.escape(fpath) + '\/?'), '');
        if (args['meta-touch']) {
            var n, meta, m;
            if ((m = path.match(/(.*)\.user.js$/)) && (n = m[1]) && (meta = `${n}.meta.json`) && fs.existsSync(meta)) {
                if (args.debug) console.log('metatouch: ', meta);
                try {
                    // This is nuts! But this seems to be the only way to update file timestamps reliably at Windows 10
                    // require('touch'), fs.utimes -> EPERM: operation not permitted, futime
                    var c = fs.readFileSync(meta);
                    fs.writeFileSync(meta, c);
                } catch (e) {
                    console.error(e);
                }
            }
        }
        if (!wc) {
            wc = watcherCache[rpath] = { changes: {}, to: null, current_cursor: 1 };
        }
        if (!(cc = wc.changes[wc.current_cursor])) {
            cc = wc.changes[wc.current_cursor] = {};
        }
        if (!cc[filename]) {
            cc[filename] = true;
        }
        if (wc.to) {
            global.clearTimeout(wc.to);
        }
        // collect all changes until there is no change for one second
        wc.to = global.setTimeout(function() {
            sendCachedWatcherChanges(rpath, wc.current_cursor);
            var o = watcherCache[rpath];
            o.to = null;
            wc.current_cursor++;
        }, 1000);
    }))
    .on('change', onchange)
    .on('unlink', onchange)
    .on('error', function() {
        notifySubscribers(rpath, wc ? wc.changes : []);
    });

    watchers[rpath] = w;
};

const requestHandler = function(request, response) {
    var uri = url.parse(request.url);
    var url_args = getUrlArgs(uri.search || '');
    var method = url_args.method || request.method.toLowerCase();
    var m;

    request.on('error', function(err) {
        console.error(err.stack);
    });

    if (args.debug) {
        var sh = response.setHeader;
        var e = response.end;

        response.setHeader = function() {
            console.log('response.setHeader', arguments);
            sh.apply(response, arguments);
        };
        response.end = function() {
            console.log('response.end', arguments);
            e.apply(response, arguments);
        };
        console.log('request', method, request.url, request.headers);
    }

    if (args.username || args.password) {
        var a, b, d;
        if (!(a = request.headers.authorization) ||
            !(b = a.match('Basic (.*)')[1]) ||
            !(d = btoa(b).split(':')) ||
            d[0] != args.username ||
            d[1] != args.password) {

            response.setHeader('WWW-Authenticate', 'Basic realm="Enter credentials"');
            response.statusCode = 401;
            response.end();
            return;
        }
    }

    if ((m = methods[method])) {
        response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0');
        response.setHeader('DAV', '1');

        return m(uri, request, response);
    } else {
        console.log(`unknown method ${request.method}`);
        response.statusCode = 501;
        response.end();
    }
};

const server = http.createServer(requestHandler);
const host = args.host || 'localhost';

server.listen(port, host, function(err) {
    if (err) {
        return console.log(err);
    }

    console.log(`server is listening on ${port}`);
});
