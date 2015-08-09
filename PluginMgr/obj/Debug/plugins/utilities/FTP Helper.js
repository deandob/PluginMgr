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

// Process host messages
exports.fromHost = function fromHost(channel, scope, data) {
    console.log("in ftp fromhost")
    if (session.connected) {
        getList(data)
    } else {
        waitingForList = data
        startSession()
    }
    console.log("out ftp fromhost")
    return "OK"
}

function getList(dirList) {
    console.log("in ftp getlist")
    try {
        //session.list(settings["dir"], function (err, list) {
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
                if (list.length > 0) {
                    fw.toHost(fw.channels[0].name, fw.channels[0].units, JSON.stringify(list))       // send directory listing back to the host
                    fw.log("Directory List retrieved - " + dirList)
                    waitingForList = null;
                }
            }
        });
        console.log("out ftp fromhost")
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

// Shutdown the plugin
exports.shutPlugin = function shutPlugin(param) {
    //Insert any orderly shutdown code needed here
    session.end();
    return "OK"
}

// Initialize the plugin - DO NOT MODIFY THIS FUNCTION
var fw = new Object();
exports.loaded = function(iniCat, iniName, iniChannels, iniSettings, iniStore) {
    fw.cat = iniCat;
    fw.plugName = iniName;
    fw.channels = iniChannels;
    fw.settings = iniSettings;
    fw.store = iniStore;
    fw.log = function (msg) { module.parent.exports.log(fw.cat + "/" + fw.plugName, msg) };
    fw.toHost = function (myChannel, myScope, myData) {module.parent.exports.toHost(fw.cat, fw.plugName, myChannel, myScope, myData)};
    fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) {module.parent.exports.addChannel(fw.cat, fw.plugName, name, desc, type, io, min, max, units, attribs, value, store)};
    return startup();
}
