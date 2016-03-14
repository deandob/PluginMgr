"use strict";

var fs = require('fs');
var lame = require('lame');
var speaker = require('speaker');
var count;
var playing = false;
var stream = [];

function startup() {
    //Insert startup code here
    return "OK"                                                     // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

// Receive a message from the host
function fromHost(channel, scope, data) {
    //Insert code to manage messages from the host
    count = 0;
    playSound(fw.channels[0].attribs[+data].value);
}

function playSound(file) {
//    fw.log("audio sound requested " + playing)
    if (playing === true) return;                                        // ignore multiple commands while playing
    fw.log("Playing file: " + file);
    playing = true;
    sendToSpeaker(file);
}

function sendToSpeaker(file) {
    var mySpeaker = new speaker
    fs.createReadStream("plugins/" + fw.cat + "/" + file)
        .pipe(new lame.Decoder())
        .pipe(mySpeaker)

    mySpeaker.on("flush", function () {
        if (count < +fw.settings.repeat) {
            setTimeout(sendToSpeaker, 800, file);
        } else {
            playing = false;
            fw.log("Stopped playing " + file);
        }
    })
    count = count + 1;
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

