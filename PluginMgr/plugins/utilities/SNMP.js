"use strict";

//SNMP library https://nym.se/node-snmp-native/docs/example.html https://nym.se/node-snmp-native/docs/snmp.html https://github.com/calmh/node-snmp-native
var snmp = require("snmp-native");
var session, timer; 

// startup function
function startup() {
    session = new snmp.Session({ host: fw.settings["ip address"], community: fw.settings["community"] });
    // Loop polling the required OIDs
    timer = setInterval(pollOID, fw.settings["pollsecs"] * 1000);
    return "OK"                                 // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

function pollOID() {
    for (var channel in fw.channels) {
        session.get({ oid: fw.channels[channel].attribs[0].value }, function (channel, err, varbinds) {
                if (err) {
                    fw.log(fw.channels[channel].attribs[0].name + " SNMP GET error. " + err);
                } else {
                    if (fw.channels[channel].value !== varbinds[0].value) {                    // Has the value changed?
                        fw.channels[channel].value = parseInt(varbinds[0].value)               // Only send if we have a new value
                        fw.toHost(fw.channels[channel].name, fw.channels[channel].units, fw.channels[channel].value / parseInt(fw.channels[channel].attribs[1].value));
                    }
                }
        }.bind(this, channel));
    }
}

// Shutdown the plugin. Insert any orderly shutdown code needed here
function shutPlugin(param) {
    session.close();
    clearInterval(timer);
    return "OK"
}

        // For firmware g version, seems each firmware rev the last number of the Oid is incremented
        //.1.3.6.1.2.1.10.94.1.1.3.1.5.3 Down Attenuation
        //.1.3.6.1.2.1.10.94.1.1.2.1.5.3 Up Attenuation
        //.1.3.6.1.2.1.10.94.1.1.3.1.4.3 Down SNR
        //.1.3.6.1.2.1.10.94.1.1.2.1.4.3 Up SNR
        //.1.3.6.1.2.1.10.94.1.1.3.1.8.3 Down Speed
        //.1.3.6.1.2.1.10.94.1.1.2.1.8.3 Up Speed

// Receive a message from the host
function fromHost(channel, scope, data) {
    //Insert code to manage messages from the host
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
