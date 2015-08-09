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
    console.log("in snmp poll")
    for (var channel in fw.channels) {
        session.get({ oid: fw.channels[channel].attribs[0].value }, function (channel, err, varbinds) {
                if (err) {
                    fw.log(fw.channels[channel].attribs[0].name + " SNMP GET error. " + err);
                } else {
                    if (fw.channels[channel].value !== varbinds[0].value) {                    // Has the value changed?
                        fw.channels[channel].value = parseInt(varbinds[0].value)               // Only send if we have a new value
                        //toHost(channels[channel].name, channels[channel].units, channels[channel].value / parseInt(channels[channel].attribs[1].value));
                    }
                }
        }.bind(this, channel));
    }
    console.log("out snmp poll")
}

// Shutdown the plugin. Insert any orderly shutdown code needed here
exports.shutPlugin = function shutPlugin(param) {
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
