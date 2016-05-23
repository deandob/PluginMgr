"use strict";
//var https = require('https');
//var url = require('url'); 
var TelstraAPI = require('telstra-api');
var t; 

function startup() {
    //Insert startup code here
    t = new TelstraAPI(fw.settings.consumer_key, fw.settings.consumer_secret, "SMS");
    return "OK"                                                     // Return 'OK' only if startup has been successful to ensure startup errors disable plugin

}

/*
curl - X POST \
-H "Content-Type: application/x-www-form-urlencoded" \
-d "client_id=$CONSUMER_KEY&client_secret=$CONSUMER_SECRET&grant_type=client_credentials&scope=SMS" \
""

var body = JSON.stringify({
    client_id: fw.settings.consumer_key,
    client_secret: fw.settings.consumer_secret,
    grant_type: 'client_credentials',
    scope: 'SMS'
});

var uriObj = url.parse(fw.settings.authurl);
uriObj.method = "post";
uriObj.headers = {
    'Accept': 'application/json', 
    'Content-Length': body.length,
    'Content-Type': 'application/x-www-form-urlencoded' 
}; 
*/

// Receive a message from the host
function fromHost(channel, scope, data) {
    //Insert code to manage messages from the host
    //    switch (scope.toLowerCase()) {
    //        case "group0":
    //            break;
    //        case "group1":
    //            break;
    //    }
    var myscope = scope.toLowerCase();
    if (typeof fw.settings[myscope] !== "undefined") {
        for (var mobile in fw.settings[myscope]) {
            var ttt = fw.settings[myscope][mobile].Number
            t.sms.send(fw.settings[myscope][mobile].Number, "[31Needham] message for " + fw.settings[myscope][mobile].Name + ": " + data);
            console.log(fw.settings[myscope][mobile].Number + "  -> [31Needham] message for " + fw.settings[myscope][mobile].Name + ", " + data);
        }
    }
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

