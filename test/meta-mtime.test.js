#!/usr/bin/env node
'use strict';

// End-to-end test for the reported mtime of a `<uuid>.meta.json` sidecar.
//
// Tampermonkey decides whether to pull a script from the mtime it sees for the sidecar,
// never from the script itself. This spawns a real server over a temp storage dir, issues
// a PROPFIND, and reads `<d:getlastmodified>` off the wire -- the same value the browser
// acts on -- rather than calling an internal function.
//
// Run:  node test/meta-mtime.test.js
// The fault arm (proving the assertions can fail) is:
//   git stash && node test/meta-mtime.test.js ; git stash pop
// against the unpatched server, where SIDECAR TRACKS SCRIPT and SYMLINKED SCRIPT fail.

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server.js');

const failures = [];
const check = function(name, ok, detail) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
    if (!ok) failures.push(name);
};

const freePort = function() {
    return new Promise(function(resolve, reject) {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', function() {
            const p = s.address().port;
            s.close(function() { resolve(p); });
        });
    });
};

const propfind = function(port, rpath) {
    return new Promise(function(resolve, reject) {
        const req = http.request({
            host: '127.0.0.1', port: port, path: rpath,
            method: 'PROPFIND', headers: { depth: 1 }
        }, function(res) {
            let body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() { resolve({ status: res.statusCode, body: body }); });
        });
        req.on('error', reject);
        req.end();
    });
};

// href -> Date, parsed out of the multistatus the browser would receive.
const parseListing = function(xml) {
    const out = {};
    const re = /<d:response>[\s\S]*?<d:href>([^<]*)<\/d:href>[\s\S]*?<d:getlastmodified>([^<]*)<\/d:getlastmodified>/g;
    let m;
    while ((m = re.exec(xml))) out[m[1]] = new Date(m[2]);
    return out;
};

const waitForServer = async function(port) {
    for (let i = 0; i < 100; i++) {
        try {
            const r = await propfind(port, '/');
            if (r.status === 207) return;
        } catch (e) { /* not up yet */ }
        await new Promise(function(r) { setTimeout(r, 50); });
    }
    throw new Error(`server never answered on port ${port}`);
};

// getlastmodified is second-resolution (toGMTString), so all fixtures sit on whole seconds.
const sec = 1000;
const now = Math.floor(Date.now() / sec) * sec;
const T_OLD = now - 600 * sec;   // sidecar, written long ago
const T_NEW = now - 60 * sec;    // script, edited since

const main = async function() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tamperdav-test-'));
    const sync = path.join(root, 'dav', 'Tampermonkey', 'sync');
    fs.mkdirSync(sync, { recursive: true });

    // 1. The reported case: script newer than its sidecar.
    fs.writeFileSync(path.join(sync, 'stale.user.js'), '// script\n');
    fs.writeFileSync(path.join(sync, 'stale.meta.json'), '{"name":"stale"}\n');
    fs.utimesSync(path.join(sync, 'stale.user.js'), T_NEW / sec, T_NEW / sec);
    fs.utimesSync(path.join(sync, 'stale.meta.json'), T_OLD / sec, T_OLD / sec);

    // 2. The real setup: the script is a symlink into a repo tree.
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    const real = path.join(repo, 'linked.user.js');
    fs.writeFileSync(real, '// linked script\n');
    fs.utimesSync(real, T_NEW / sec, T_NEW / sec);
    fs.symlinkSync(real, path.join(sync, 'linked.user.js'));
    fs.writeFileSync(path.join(sync, 'linked.meta.json'), '{"name":"linked"}\n');
    fs.utimesSync(path.join(sync, 'linked.meta.json'), T_OLD / sec, T_OLD / sec);

    // 3. A sidecar with no script beside it must keep reporting its own mtime.
    fs.writeFileSync(path.join(sync, 'orphan.meta.json'), '{"name":"orphan"}\n');
    fs.utimesSync(path.join(sync, 'orphan.meta.json'), T_OLD / sec, T_OLD / sec);

    const port = await freePort();
    const srv = spawn(process.execPath, [SERVER, '--path=dav', '--no-auth-warning', '--headless', `--port=${port}`, '--host=127.0.0.1'], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    srv.stderr.on('data', function(c) { stderr += c; });

    try {
        await waitForServer(port);
        const res = await propfind(port, '/Tampermonkey/sync/');
        const seen = parseListing(res.body);

        const at = function(name) {
            const d = seen['/Tampermonkey/sync/' + name];
            return d ? d.getTime() : null;
        };

        // Control on the same instrument, expected value non-empty: the listing really
        // does carry these files and their mtimes, so an assertion below that reads null
        // is a broken fixture, not a passing test.
        check('CONTROL: listing carries all four fixtures',
            Object.keys(seen).length >= 4, `${Object.keys(seen).length} entries: ${Object.keys(seen).join(' ')}`);
        check('CONTROL: a plain script reports its own mtime',
            at('stale.user.js') === T_NEW, `${at('stale.user.js')} vs ${T_NEW}`);

        check('SIDECAR TRACKS SCRIPT: stale.meta.json reports the script mtime',
            at('stale.meta.json') === T_NEW, `${at('stale.meta.json')} vs ${T_NEW}`);
        check('SYMLINKED SCRIPT: linked.meta.json reports the repo file mtime',
            at('linked.meta.json') === T_NEW, `${at('linked.meta.json')} vs ${T_NEW}`);
        check('ORPHAN SIDECAR: no script beside it, keeps its own mtime',
            at('orphan.meta.json') === T_OLD, `${at('orphan.meta.json')} vs ${T_OLD}`);
    } finally {
        srv.kill();
        fs.rmSync(root, { recursive: true, force: true });
    }

    if (failures.length) {
        console.error(`\n${failures.length} failing: ${failures.join(', ')}`);
        if (stderr.trim()) console.error(`server stderr:\n${stderr}`);
        process.exit(1);
    }
    console.log('\nall passing');
};

main().catch(function(e) { console.error(e); process.exit(1); });
