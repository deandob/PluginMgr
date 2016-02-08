"use strict";
var http = require("http");

function startup() {
    //Insert startup code here
    pollNet(fw.settings.testurl);
    setInterval(pollNet, +fw.settings.interval * 60000, fw.settings.testurl);
    return "OK"                                                     // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

function pollNet(url) {
    try {
        var startTime = process.hrtime();
        http.get(url, function (response) {
            response.on('data', function (chunk) {
                var dummy = chunk;                      // required else end event won't be triggered
            })
            response.on('end', function () {
                var diff = process.hrtime(startTime);
                var mBitSec = +(8 / ((diff[0] * 1e9 + diff[1]) * 1e-9)).toFixed(3)
                var mByteSec = +(1 / ((diff[0] * 1e9 + diff[1]) * 1e-9)).toFixed(3)
                fw.toHost(fw.channels[0].name, fw.channels[0].units, mBitSec)
            //fw.log("Internet speed Mbps: " + mBitSec + "Mbit/Sec, Download speed MByte/Sec: "  + mByteSec)
            })
        });
    } catch (e) {
        fw.log("Error occurred: " + e.toString())
    }
}

// Receive a message from the host
exports.fromHost  = function(channel, scope, data) {
    //Insert code to manage messages from the host
}

// Shutdown the plugin
exports.shutPlugin = function shutPlugin(param) {
    //Insert any orderly shutdown code needed here
    return "OK"
}

// Initialize the plugin - DO NOT MODIFY THIS FUNCTION
var fw = new Object();
exports.loaded = function (iniCat, iniName, iniChannels, iniSettings, iniStore) {
    fw.cat = iniCat;
    fw.plugName = iniName;
    fw.channels = iniChannels;
    fw.settings = iniSettings;
    fw.store = iniStore;
    fw.restart = function (code) { module.parent.exports.restart(code) };
    fw.log = function (msg) { module.parent.exports.log(fw.cat + "/" + fw.plugName, msg) };
    fw.toHost = function (myChannel, myScope, myData, myLog) { module.parent.exports.toHost(fw.cat, fw.plugName, myChannel, myScope, myData, myLog) };
    fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) { module.parent.exports.addChannel(fw.cat, fw.plugName, name, desc, type, io, min, max, units, attribs, value, store) };
    return startup();
}
