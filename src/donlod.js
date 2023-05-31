import "dotenv/config";

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomBytes } from "crypto";

const ipSalt = randomBytes(64).toString('hex');

import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename).slice(0, -4); // go up another level (get rid of src/)

import { getCurrentBranch, shortCommit } from "./modules/sub/currentCommit.js";
import { appName, genericUserAgent, version } from "./modules/config.js";
import { getJSON } from "./modules/api.js";
import { apiJSON, checkJSONPost, getIP, languageCode } from "./modules/sub/utils.js";
import { Bright, Cyan, Green, Red } from "./modules/sub/consoleText.js";
import stream from "./modules/stream/stream.js";
import loc from "./localization/manager.js";
import { buildFront } from "./modules/build.js";
import { changelogHistory } from "./modules/pageRender/onDemand.js";
import { sha256 } from "./modules/sub/crypto.js";
import findRendered from "./modules/pageRender/findRendered.js";
import { celebrationsEmoji } from "./modules/pageRender/elements.js";

if (process.env.selfURL && process.env.port) {
    const commitHash = shortCommit();
    const branch = getCurrentBranch();
    const app = express();

    app.disable('x-powered-by');

    const corsConfig = process.env.cors === '0' ? { origin: process.env.selfURL, optionsSuccessStatus: 200 } : {};

    const apiLimiter = rateLimit({
        windowMs: 60000,
        max: 25,
        standardHeaders: false,
        legacyHeaders: false,
        keyGenerator: (req, res) => sha256(getIP(req), ipSalt),
        handler: (req, res, next, opt) => {
            res.status(429).json({ "status": "error", "text": loc(languageCode(req), 'ErrorRateLimit') });
            return;
        }
    });
    const apiLimiterStream = rateLimit({
        windowMs: 60000,
        max: 28,
        standardHeaders: false,
        legacyHeaders: false,
        keyGenerator: (req, res) => sha256(getIP(req), ipSalt),
        handler: (req, res, next, opt) => {
            res.status(429).json({ "status": "error", "text": loc(languageCode(req), 'ErrorRateLimit') });
            return;
        }
    });

    await buildFront(commitHash, branch);

    app.use('/api/:type', cors(corsConfig));
    app.use('/api/json', apiLimiter);
    app.use('/api/stream', apiLimiterStream);
    app.use('/api/onDemand', apiLimiter);

    app.use('/', express.static('./min'));
    app.use('/', express.static('./src/front'));

    app.use((req, res, next) => {
        try { decodeURIComponent(req.path) } catch (e) { return res.redirect('/') }
        next();
    });
    app.use((req, res, next) => {
        if (req.header("user-agent") && req.header("user-agent").includes("Trident")) res.destroy();
        next();
    });
    app.use('/api/json', express.json({
        verify: (req, res, buf) => {
            try {
                JSON.parse(buf);
                if (buf.length > 720) throw new Error();
                if (String(req.header('Content-Type')) !== "application/json") {
                    res.status(400).json({ 'status': 'error', 'text': 'invalid content type header' });
                    return;
                }
                if (String(req.header('Accept')) !== "application/json") {
                    res.status(400).json({ 'status': 'error', 'text': 'invalid accept header' });
                    return;
                }
            } catch(e) {
                res.status(400).json({ 'status': 'error', 'text': 'invalid json body.' });
                return;
            }
        }
    }));

    app.post('/api/json', async (req, res) => {
        try {
            let ip = sha256(getIP(req), ipSalt);
            let lang = languageCode(req);
            let j = apiJSON(0, { t: "Bad request" });
            try {
                let request = req.body;
                if (request.url) {
                    request.dubLang = request.dubLang ? lang : false;
                    let chck = checkJSONPost(request);
                    if (chck) chck["ip"] = ip;
                    j = chck ? await getJSON(chck["url"], lang, chck) : apiJSON(0, { t: loc(lang, 'ErrorCouldntFetch') });
                } else {
                    j = apiJSON(0, { t: loc(lang, 'ErrorNoLink') });
                }
            } catch (e) {
                j = apiJSON(0, { t: loc(lang, 'ErrorCantProcess') });
            }
            res.status(j.status).json(j.body);
            return;
        } catch (e) {
            res.destroy();
            return
        }
    });

    app.get('/api/:type', (req, res) => {
        try {
            let ip = sha256(getIP(req), ipSalt);
            switch (req.params.type) {
                case 'stream':
                    if (req.query.p) {
                        res.status(200).json({ "status": "continue" });
                        return;
                    } else if (req.query.t && req.query.h && req.query.e) {
                        stream(res, ip, req.query.t, req.query.h, req.query.e);
                    } else {
                        let j = apiJSON(0, { t: "no stream id" })
                        res.status(j.status).json(j.body);
                        return;
                    }
                    break;
                case 'onDemand':
                    if (req.query.blockId) {
                        let blockId = req.query.blockId.slice(0, 3);
                        let r, j;
                        switch(blockId) {
                            case "0": // changelog history
                                r = changelogHistory();
                                j = r ? apiJSON(3, { t: r }) : apiJSON(0, { t: "couldn't render this block" })
                                break;
                            case "1": // celebrations emoji
                                r = celebrationsEmoji();
                                j = r ? apiJSON(3, { t: r }) : false
                                break;
                            default:
                                j = apiJSON(0, { t: "couldn't find a block with this id" })
                                break;
                        }
                        if (j.body) {
                            res.status(j.status).json(j.body)
                        } else {
                            res.status(204).end()
                        }
                    } else {
                        let j = apiJSON(0, { t: "no block id" });
                        res.status(j.status).json(j.body)
                    }
                    break;
                default:
                    let j = apiJSON(0, { t: "unknown response type" })
                    res.status(j.status).json(j.body);
                    break;
            }
        } catch (e) {
            res.status(500).json({ 'status': 'error', 'text': loc(languageCode(req), 'ErrorCantProcess') });
            return;
        }
    });
    app.get("/api", (req, res) => {
        res.redirect('/api/json')
    });
    app.get("/status", (req, res) => {
        res.status(200).end()
    });
    app.get("/", (req, res) => {
        res.sendFile(`${__dirname}/${findRendered(languageCode(req), req.header('user-agent') ? req.header('user-agent') : genericUserAgent)}`);
    });
    app.get("/favicon.ico", (req, res) => {
        res.redirect('/icons/favicon.ico');
    });
    app.get("/*", (req, res) => {
        res.redirect('/')
    });

    app.listen(process.env.port, () => {
        let startTime = new Date();
        console.log(`\n${Cyan(appName)} ${Bright(`v.${version}-${commitHash} (${branch})`)}\nStart time: ${Bright(`${startTime.toUTCString()} (${Math.floor(new Date().getTime())})`)}\n\nURL: ${Cyan(`${process.env.selfURL}`)}\nPort: ${process.env.port}\n`)
    })
} else {
    console.log(Red(`donlod hasn't been configured yet or configuration is invalid.\n`) + Bright(`please run the setup script to fix this: `) + Green(`npm run setup`));
}
