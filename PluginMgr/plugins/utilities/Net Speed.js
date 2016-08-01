"use strict";
var http = require("http");
var netState = "down";
var mBitSec = 0;
var mByteSec;

function startup() {
    //Insert startup code here
    pollNet(fw.settings.testurl);
    setInterval(pollNet, +fw.settings.interval * 60000, fw.settings.testurl);       // delay in minutes
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
                mBitSec = +(8 / ((diff[0] * 1e9 + diff[1]) * 1e-9)).toFixed(3)
                mByteSec = +(1 / ((diff[0] * 1e9 + diff[1]) * 1e-9)).toFixed(3)
                fw.toHost(fw.channels[0].name, fw.channels[0].units, mBitSec);
                fw.log("Internet speed Mbps: " + mBitSec + "Mbit/Sec, Download speed MByte/Sec: " + mByteSec)
                testState();
            });
            response.on('error', function (e) {
                fw.toHost(fw.channels[0].name, fw.channels[0].units, 0);
                netState = "down";
                testState();
                fw.log("Network error occurred, internet is down. " + e.message);
            });
        }).on('error', function (e) {
            fw.toHost(fw.channels[0].name, fw.channels[0].units, 0);
            netState = "down";
            testState();
            fw.log("Network error occurred, internet is down. " + e.message);
        })
    } catch (e) {
        netState = "down";
        testState();
        fw.log("Error occurred: " + e.message)
    }
}

function testState() {
    if (netState == "down") {
        if (mBitSec < 0.5) {
            fw.log("Internet speed < 500kBps for several minutes, network is down.");
        } else {
            fw.log("Internet network is up.");
            netState = "up";
        }
        fw.toHost(fw.channels[1].name, fw.channels[0].units, netState);
    }
    if (mBitSec < 0.5) netState = "down";                   // might be spurious, give it another poll cycle before sending alert
}

// Receive a message from the host
function fromHost(channel, scope, data) {
    //Insert code to manage messages from the host
}

// Shutdown the plugin
function shutPlugin(param) {
    //Insert any orderly shutdown code needed here
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
