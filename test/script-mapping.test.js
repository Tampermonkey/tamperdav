#!/usr/bin/env node
'use strict';

// End-to-end test for the `scripts` config mapping: a script that lives in a repo and is
// named in the config rather than symlinked into the sync directory.
//
// Every assertion goes over the wire against a real spawned server, so it exercises the
// same paths Tampermonkey drives. The unmapped fixture is the control: it proves each
// assertion is reading a live listing and a live handler, not an empty one.
//
// Run:  node test/script-mapping.test.js
// Fault arm: git stash && node test/script-mapping.test.js ; git stash pop
//   -- against the unpatched server every MAPPED arm fails and the CONTROL arms pass.

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

const request = function(port, method, rpath, body) {
    return new Promise(function(resolve, reject) {
        const req = http.request({
            host: '127.0.0.1', port: port, path: rpath,
            method: method, headers: { depth: 1 }
        }, function(res) {
            let out = '';
            res.on('data', function(c) { out += c; });
            res.on('end', function() { resolve({ status: res.statusCode, body: out }); });
        });
        req.on('error', reject);
        req.end(body);
    });
};

// Split into <d:response> blocks FIRST, then read each one. A flat regex across the whole
// document runs past the directory entry -- its getcontentlength is self-closing, so a
// non-greedy match reaches forward into the next response and swallows it.
const parseListing = function(xml) {
    const out = {};
    (xml.match(/<d:response>[\s\S]*?<\/d:response>/g) || []).forEach(function(block) {
        const href = block.match(/<d:href>([^<]*)<\/d:href>/);
        const mtime = block.match(/<d:getlastmodified>([^<]*)<\/d:getlastmodified>/);
        const size = block.match(/<d:getcontentlength>([^<]*)<\/d:getcontentlength>/);
        if (!href) return;
        out[href[1]] = {
            mtime: mtime ? new Date(mtime[1]).getTime() : null,
            size: size ? parseInt(size[1], 10) : null
        };
    });
    return out;
};

const waitForServer = async function(port) {
    for (let i = 0; i < 100; i++) {
        try {
            const r = await request(port, 'PROPFIND', '/');
            if (r.status === 207) return;
        } catch (e) { /* not up yet */ }
        await new Promise(function(r) { setTimeout(r, 50); });
    }
    throw new Error(`server never answered on port ${port}`);
};

const sec = 1000;
const now = Math.floor(Date.now() / sec) * sec;
const T_OLD = now - 600 * sec;
const T_NEW = now - 60 * sec;

const MAPPED_BODY = '// the copy that lives in the repo\n';
const PLAIN_BODY = '// an ordinary script in the sync dir\n';

const main = async function() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tamperdav-map-'));
    const sync = path.join(root, 'dav', 'Tampermonkey', 'sync');
    const repo = path.join(root, 'repo');
    fs.mkdirSync(sync, { recursive: true });
    fs.mkdirSync(repo);

    // MAPPED: a sidecar in the sync dir, its script only in the repo. No symlink, and
    // nothing named `mapped.user.js` in the sync directory at all.
    const repoScript = path.join(repo, 'thing.user.js');
    fs.writeFileSync(repoScript, MAPPED_BODY);
    fs.utimesSync(repoScript, T_NEW / sec, T_NEW / sec);
    fs.writeFileSync(path.join(sync, 'mapped.meta.json'), JSON.stringify({ uuid: 'mapped', name: 'Repo Script' }) + '\n');
    fs.utimesSync(path.join(sync, 'mapped.meta.json'), T_OLD / sec, T_OLD / sec);

    // CONTROL: an ordinary script that is not mapped, on the same instrument.
    fs.writeFileSync(path.join(sync, 'plain.user.js'), PLAIN_BODY);
    fs.writeFileSync(path.join(sync, 'plain.meta.json'), JSON.stringify({ uuid: 'plain', name: 'Plain Script' }) + '\n');
    fs.utimesSync(path.join(sync, 'plain.user.js'), T_OLD / sec, T_OLD / sec);
    fs.utimesSync(path.join(sync, 'plain.meta.json'), T_OLD / sec, T_OLD / sec);

    const port = await freePort();
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
        path: 'dav',
        host: '127.0.0.1',
        port: port,
        headless: true,
        'no-auth-warning': true,
        scripts: { 'Repo Script': repoScript }
    }, null, 4));

    const srv = spawn(process.execPath, [SERVER], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    srv.stderr.on('data', function(c) { stderr += c; });

    try {
        await waitForServer(port);

        const listing = parseListing((await request(port, 'PROPFIND', '/Tampermonkey/sync/')).body);
        const at = function(n) { return listing['/Tampermonkey/sync/' + n] || {}; };

        check('CONTROL: the listing carries the unmapped script',
            at('plain.user.js').size === PLAIN_BODY.length,
            `size ${at('plain.user.js').size}`);
        check('CONTROL: an unmapped GET returns the local bytes',
            (await request(port, 'GET', '/Tampermonkey/sync/plain.user.js')).body === PLAIN_BODY);

        check('MAPPED: the listing synthesizes the script with no file in the sync dir',
            at('mapped.user.js').size === MAPPED_BODY.length,
            `size ${at('mapped.user.js').size}, expected ${MAPPED_BODY.length}`);
        check('MAPPED: the synthesized entry carries the repo file mtime',
            at('mapped.user.js').mtime === T_NEW,
            `${at('mapped.user.js').mtime} vs ${T_NEW}`);
        check('MAPPED: the sidecar tracks the repo file, not its own mtime',
            at('mapped.meta.json').mtime === T_NEW,
            `${at('mapped.meta.json').mtime} vs ${T_NEW}`);

        const got = await request(port, 'GET', '/Tampermonkey/sync/mapped.user.js');
        check('MAPPED: GET serves the repo file bytes',
            got.status === 200 && got.body === MAPPED_BODY, `status ${got.status}`);

        const written = '// edited in the browser\n';
        const put = await request(port, 'PUT', '/Tampermonkey/sync/mapped.user.js', written);
        check('MAPPED: PUT writes through to the repo file',
            put.status === 200 && fs.readFileSync(repoScript, 'utf8') === written,
            `status ${put.status}, repo file now ${JSON.stringify(fs.readFileSync(repoScript, 'utf8'))}`);
        check('MAPPED: PUT does not create a shadow copy in the sync dir',
            !fs.existsSync(path.join(sync, 'mapped.user.js')));

        const del = await request(port, 'DELETE', '/Tampermonkey/sync/mapped.user.js');
        check('MAPPED: DELETE is refused and the repo file survives',
            del.status === 403 && fs.existsSync(repoScript), `status ${del.status}`);

        const delPlain = await request(port, 'DELETE', '/Tampermonkey/sync/plain.user.js');
        check('CONTROL: DELETE still removes an unmapped script',
            delPlain.status === 204 && !fs.existsSync(path.join(sync, 'plain.user.js')),
            `status ${delPlain.status}`);
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
