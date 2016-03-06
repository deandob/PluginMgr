"use strict";

var whatsapi, whatsapp, waApi;

function startup() {
    //Insert startup code here
    fw.log("Starting Whatsapp API Server...")
    waApi = require('node-wa');
//    whatsapp = whatsapi.createAdapter({
//        msisdn: fw.settings.msisdn, // phone number with country code
//        username: fw.settings.username, // your name on WhatsApp
//        password: fw.settings.password, // WhatsApp password
//        ccode: fw.settings.ccode // country code
//    });
    
    var whatsapi = new waApi(fw.settings.username, fw.settings.password, { displayName: '31 Needham', debug: true });    
  
    whatsapi.on("connect", function (err) { fw.log("GOT HERE -------------------------------------------------")})
      
/*    whatsapp.connect(function connected(err) {
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
*/
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
        //}
    //}
    
/*    whatsapp.on('receivedMessage', function (message) {
        fw.log("Received Whatsapp from " + message.notify + ", message: " + message.body);
    });
*/        
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
function fromHost(channel, scope, data) {
    for (var attrib in fw.channels[0].attribs) {
        waSend(fw.channels[0].attribs[attrib].value, data);
    }
}

// Shutdown the plugin
function shutPlugin(param) {
    whatsapp.sendIsOffline();
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
