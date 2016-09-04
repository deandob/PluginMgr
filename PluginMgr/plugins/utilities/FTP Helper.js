"use strict";

// General FTP helper which sets up session with FTP host and makes directory requests
var ftp = require("ftp");
var session;

// startup function
var waitingForList = null;
function startup() {
    try {
        session = new ftp();
        session.on('ready', function () {       // setup callback once session is connected
            fw.log("Connected to FTP host " + session.options.host)
            if (waitingForList !== null) getList(waitingForList)        // if an earlier message was sent but session was down, send the request now. 
        });
        session.on("error", function (err) {
            fw.log("FTP session error: " + err)
            setTimeout(startSession, 3000);         // try reconnecting after 3 seconds
            return err;
        });
        return startSession()                   // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
    } catch(err) {
        fw.log("FTP general error: " + err)
        setTimeout(startSession, 3000);         // try reconnecting after 3 seconds
        return err;
    }
}

function startSession() {
    try {
        if (!session.connected) session.connect({                   // create a session with the FTP host
            host: fw.settings["ftpserver"]
        });
        return "OK"
    } catch(err) {
        fw.log("FTP general connect error: " + err)
        setTimeout(startSession, 3000);         // try reconnecting after 3 seconds
        return err;
    }
}

function getList(dirList) {
    try {
        //session.list(settings["dir"], function (err, list) {
        fw.log(dirList + " ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++")
        session.list(dirList, function (err, list) {
            if (err) {
                fw.log("FTP reading radar directory error: " + err)
                if (!session.connected) {
                    startSession();
                } else {
                    setTimeout(getList, 3000, dirList);         // try again after 3 seconds
                }
                return err
            } else {
                try {
                    if (list.length > 0) {
                        fw.toHost(fw.channels[0].name, fw.channels[0].units, JSON.stringify(list), false)       // send directory listing back to the host
                        fw.log("Directory List retrieved - " + dirList)
                        waitingForList = null;
                    }
                } catch (e) {
                    setTimeout(getList, 3000, dirList);         // try again after 3 seconds
                }
            }
        });
        return "OK"
    } catch (err) {
        fw.log("FTP reading radar directory error: " + err)
        if (!session.connected) {
            startSession();
        } else {
            setTimeout(getList, 3000, dirList);         // try again after 3 seconds
        }
        return err
    }
}


// Process host messages
function fromHost(channel, scope, data) {
    if (session.connected) {
        getList(data)
    } else {
        waitingForList = data
        startSession()
    }
    return "OK"
}

// Shutdown the plugin
function shutPlugin(param) {
    //Insert any orderly shutdown code needed here
    session.end();
    return "OK"
}

// Initialize the plugin -------------- DO NOT MODIFY THIS SECTION
var fw = new Object();
process.on('message', function (msg) {
    var retval;
    switch (msg.func.toLowerCase()) {
        case "init":
            fw.cat = msg.data.cat;
            fw.plugName = msg.data.name;
            fw.channels = msg.data.channels;
            fw.settings = msg.data.settings;
            fw.store = msg.data.store;
            fw.restart = function (code) { process.exit(code) };
            fw.log = function (msg) { process.send({ func: "log", cat: fw.cat, name: fw.plugName, log: msg }); };
            fw.toHost = function (myChannel, myScope, myData, myLog) { process.send({ func: "tohost", cat: fw.cat, name: fw.plugName, channel: myChannel, scope: myScope, data: myData, log: myLog }); };
            fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) { process.send({ func: "addch", cat: fw.cat, name: fw.plugName, channel: name, scope: desc, data: { type: type, io: io, min: min, max: max, units: units, attribs: attribs, value: value, store: store } }); };
            fw.writeIni = function (section, subSection, key, value) { process.send({ func: "writeini", cat: fw.cat, name: fw.plugName, data: { section: section, subSection: subSection, key: key, value: value } }); };
            retval = startup();
            break;
        case "fromhost":
            retval = fromHost(msg.channel, msg.scope, msg.data)
            break;
        case "shutdown":
            retval = shutPlugin(msg.data);
            break;
    }
    process.send({ func: msg.func, cat: fw.cat, name: fw.plugName, data: retval, log: process.execArgv[0] });
});
