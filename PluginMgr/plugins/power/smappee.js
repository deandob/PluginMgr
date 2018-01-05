"use strict";
var http = require("http");
//TODO: IP address changes with DHCP renewals

//var loggedIn = false;
var pollTimer; 
var sensors = [];
var sensor = function (currVal, oldVal) {
    this.currVal = currVal;
    this.oldVal = oldVal;
}

function startup() {
    //Insert startup code here
    fw.log("Polling " + fw.settings.smappeeip + fw.settings.webapi + " every " + fw.settings.pollinterval + " seconds")
    for (var lp = 0; lp < fw.channels.length; lp++) {
        sensors.push(new sensor(0, -99));
    }
    logon(fw.settings.password);
    return "OK"                                                     // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
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

// POST password to smappee logon path to logon, retry if errors
function logon(password) {
    try {
        var options = {
            hostname: fw.settings.smappeeip,
            port: 80,
            path: fw.settings.logon,
            method: 'POST',
            headers: {
                'Content-Length': Buffer.byteLength(password)
            }
        };
        
        var httpPost = http.request(options, function (res) {
            if (res.statusCode == "200") {
                var httpData = "";

                res.on('data', function (chunk) { httpData += chunk; });

                res.on('end', function () {                                                     // Completed retreive
                    if (String(fw.settings.debug) === "true") fw.log("SMAPPEE logon result: " + httpData);
                    getSmappee();                                                               // Start polling for data
                    return;
                });
            } else {
                fw.log("ERROR - Can't logon to Smappee, suspect URL is specified incorrectly, check logon settings in INI file");
                setTimeout(logon, 5000, password);
            }
            res.resume();
        }).on('error', function (e) {
            fw.log("ERROR - HTTP error with Smappee logon: " + e.message + ". Check if IP address " + fw.settings.smappeeip + " is correct or if Smappee is offline");
            setTimeout(logon, 5000, password);
            });
        httpPost.write(password);
        httpPost.end();
    } catch (err) {
        fw.log("ERROR - HTTP general connect error during logon: " + err)
        setTimeout(logon, 5000, password);
    }
}

// Poll gateway API to retrieve sensor values
function getSmappee() {
    try {
        var options = {
            hostname: fw.settings.smappeeip,
            port: 80,
            path: fw.settings.webapi,
            method: 'GET'
        };
        http.get(options, function (res) {
            if (res.statusCode == "404") {
                fw.log("ERROR - Can't retrieve smappee logs, suspect URL is specified incorrectly, check webAPI settings in INI file");
            } else {
                var httpData = "";
                res.on('data', function (chunk) { httpData += chunk; });

                res.on('end', function () {                                                                 // Completed retreive
                    var phases = httpData.split("Phase ");
                    if (String(fw.settings.debug) === "true") fw.log("SMAPPEE data " + httpData);
                    if (phases.length === 1) {
                        fw.log("WARNING - Incorrect string returned, likely not logged in. Retrying logon.");
                        logon(fw.settings.password);
                        return;                                                                             // Wait for successful logon before polling again
                    } else {
                        for (var phase = 1; phase < phases.length; phase++) {
                            if (phases[phase] !== "") {
                                var splitPower = phases[phase].split("activePower=");

                                if (splitPower.length > 1) {                                                // Data exists
                                    var index = phase - 1;
                                    sensors[index].currVal = splitPower[1].split(" W")[0];
                                    if (+sensors[index].currVal > (+sensors[index].oldVal + Number(fw.settings.changetol)) || +sensors[index].currVal < (+sensors[index].oldVal - Number(fw.settings.changetol)))
                                        fw.toHost(fw.channels[index].name, "W", sensors[index].currVal);     // send if change > threshold
                                    sensors[index].oldVal = sensors[index].currVal
                                }
                            }
                        }
                    }
                });
            }
            res.resume();
        }).on('error', function (e) {
            fw.log("ERROR - HTTP error connecting to Smappee: " + e.message + ". Check if IP address " + fw.settings.smappeeip + " is correct or if Smappee is offline");
        });
    } catch (err) {
        fw.log("ERROR - HTTP general connect error: " + err)
    }
    pollTimer = setTimeout(getSmappee, +fw.settings.pollinterval * 1000);
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
