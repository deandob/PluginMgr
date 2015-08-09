"use strict";

var whatsapi, whatsapp;

function startup() {
    //Insert startup code here
    fw.log("Starting Whatsapp API Server...")
    whatsapi = require('whatsapi');
    whatsapp = whatsapi.createAdapter({
        msisdn: fw.settings.msisdn, // phone number with country code
        username: fw.settings.username, // your name on WhatsApp
        password: fw.settings.password, // WhatsApp password
        ccode: fw.settings.ccode // country code
    });
    
    whatsapp.connect(function connected(err) {
        if (err) {
            fw.log("Error with connecting to Whatsapp: " + err);
        } else {
            fw.log("Connected to Whatsapp API Server.")
            // Now login
            whatsapp.login(walogin);
        }
    });
    
    function walogin(err) {
        if (err) {
            fw.log("SYSTEM/WHATSAPP", "Error with logging into Whatsapp: " + err);
            return err;
        } else {
            fw.log("Logged into Whatsapp.");
            whatsapp.sendIsOnline();
            /*whatsapp.requestGroupsList(function (err, groups) {
            groups.forEach(function (g) {
                console.log('Name: %s, Participants: %d', g.subject, g.participants.length);
            });
        });

        /*whatsapp.requestGroupInfo("31 Needham Admins", function (err, array) {
            status("SYSTEM/WHATSAPP", "Error with sending Whatsapp message: ");
        
        });        
        /*whatsapp.createGroup('31 Needham Admins', '61404827904', function (err, group) {
            if (err) {
                status("SYSTEM/WHATSAPP", "Error with sending Whatsapp message: " + err.message);
            } else {
                status("SYSTEM/WHATSAPP", "Created Whatsapp group: " + group.subject);
            }
        });*/
        //waSend("61404827904", "plugin Server here");
        }
    }
    
    whatsapp.on('receivedMessage', function (message) {
        fw.log("Received Whatsapp from " + message.notify + ", message: " + message.body);
    });
        
    return "OK"                                                     // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

function waSend(recipient, msg) {
    whatsapp.sendComposingState(recipient);     // follow whatsapp protocol
    setTimeout(function (msg) {
        whatsapp.sendMessage(recipient, msg, function (err, id) {
            if (err) {
                fw.log("Error with sending Whatsapp message: " + err.message);
            } else {
                fw.log("Sent Whatsapp message: " + msg);
            }
        });
        whatsapp.sendPausedState(recipient);
    }, 500, msg);            // allow time for typing
}

// Receive a message from the host
exports.fromHost  = function(channel, scope, data) {
    for (var attrib in fw.channels[0].attribs) {
        waSend(fw.channels[0].attribs[attrib].value, data);
    }
}

// Shutdown the plugin
exports.shutPlugin = function shutPlugin(param) {
    whatsapp.sendIsOffline();
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

