"use strict";
var http = require("http");

var lights = [];
var light = function (name, a, currVal, oldVal) {
    this.name;
    this.a
    this.currVal = currVal;
    this.oldVal = oldVal;
}

function startup() {
    //Insert startup code here
    //fw.log("Polling " + fw.settings.smappeeip + "/" + fw.settings.webapi + " every " + fw.settings.pollinterval + " seconds")
    for (var lp = 0; lp < fw.channels.length; lp++) {
        lights.push(new light(fw.channels[lp].name, fw.channels[lp].attribs[0].value, 0, 0));
    }
    setTimeout(pollDynalite, +fw.settings.pollinterval * 1000);
    //logon(fw.settings.password);
    return "OK"                                                     // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

// Receive a message from the host
function fromHost(channel, scope, data) {
    //Insert code to manage messages from the host
    switch (scope.toUpperCase()) {
        case "CMD":                  // command
            if (data === "ALLOFF") {
                for (var lp = 0; lp < 256; lp++) {
                    if (grpStates[lp].level > 0 && grpStates[lp].watts > 0) {
                        fw.log("Turning off " + grpStates[lp].name)
                        sendCBUS(lp, 0, 0)             // Turn off all lights that are on
                    }
                }
            }
            break;

        case "VALUE":                  // light state change message echo
            break;

        case "ACTION":
            for (var lp = 0; lp < grpStates.length; lp++) {
                if (channel.toLowerCase() === grpStates[lp].name.toLowerCase()) {
                    var getParams = data.split(" ")
                    var getRamp = 0
                    if (getParams.length === 2) getRamp = getParams[1]
                    sendCBUS(lp, getParams[0], getRamp)
                }
            }
            break;

        default:
    }
}

// Shutdown the plugin
function shutPlugin(param) {
    //Insert any orderly shutdown code needed here
    return "OK"
}

function pollDynalite() {
    getDynalite();
}

function logon(password) {
    try {
        var options = {
            hostname: fw.settings.gatewayip,
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
                    if (String(fw.settings.debug) === "true") fw.log("Dynalite logon result: " + httpData);
                    setTimeout(pollSmappee, +fw.settings.pollinterval * 1000);
                });
            } else {
                fw.log("ERROR - Can't logon to Dynalite, suspect URL is specified incorrectly, check logon settings in INI file");
            }
            res.resume();
        }).on('error', function (e) {
            fw.log("ERROR - HTTP error connecting to Dynalite: " + e.message + ". Check if IP address " + fw.settings.smappeeip + " is correct or if Dynalite is offline");
            });
        httpPost.write(password);
        httpPost.end();
    } catch (err) {
        fw.log("ERROR - HTTP general connect error during logon: " + err)
        return err;
    }
}

// Issue command to gateway API to retrieve ligh value
function getDynalite(a) {
    try {
        var options = {
            hostname: fw.settings.gatewayip,
            port: 80,
            path: fw.settings.statusapi + "?a=" + a,
            method: 'GET'
        };
        http.get(options, function (res) {
            if (res.statusCode == "404") {
                fw.log("ERROR - Can't retrieve dynalite logs, suspect URL is specified incorrectly, check status API settings in INI file");
            } else {
                var httpData = "";
                res.on('data', function (chunk) { httpData += chunk; });

                res.on('end', function () {                                                     // Completed retreive
                    var phases = httpData.split("Phase ");
                    if (String(fw.settings.debug) === "true") fw.log("Dynalite data " + httpData);
                    if (phases.length === 1) {
                        fw.log("WARNING - Incorrect string returned, likely not logged in. Retrying logon.");
                        //logon(fw.settings.password);
                    } else {
                        for (var phase = 1; phase < phases.length; phase++) {
                            if (phases[phase] !== "") {
                                var splitPower = phases[phase].split("activePower=");

                                if (splitPower.length > 1) {                                        // Data exists
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
            fw.log("ERROR - HTTP error connecting to Dynalite gateway: " + e.message + ". Check if IP address " + fw.settings.gatewayip + " is correct or if gateway is offline");
        });
    } catch (err) {
        fw.log("ERROR - HTTP general connect error: " + err)
        return err;
    }
}

// Issue command to gateway API to retrieve ligh value
function setDynalite(a, p) {
    try {
        var options = {
            hostname: fw.settings.gatewayip,
            port: 80,
            path: fw.settings.statusapi + "?a=" + a + "?p=" + p,
            method: 'GET'
        };
        http.get(options, function (res) {
            if (res.statusCode == "404") {
                fw.log("ERROR - Can't retrieve dynalite logs, suspect URL is specified incorrectly, check status API settings in INI file");
            } else {
                var httpData = "";
                res.on('data', function (chunk) { httpData += chunk; });

                res.on('end', function () {                                                     // Completed retreive
                    var phases = httpData.split("Phase ");
                    if (String(fw.settings.debug) === "true") fw.log("Dynalite data " + httpData);
                    if (phases.length === 1) {
                        fw.log("WARNING - Incorrect string returned, likely not logged in. Retrying logon.");
                        //logon(fw.settings.password);
                    } else {
                        for (var phase = 1; phase < phases.length; phase++) {
                            if (phases[phase] !== "") {
                                var splitPower = phases[phase].split("activePower=");

                                if (splitPower.length > 1) {                                        // Data exists
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
            fw.log("ERROR - HTTP error connecting to Dynalite gateway: " + e.message + ". Check if IP address " + fw.settings.gatewayip + " is correct or if gateway is offline");
        });
    } catch (err) {
        fw.log("ERROR - HTTP general connect error: " + err)
        return err;
    }
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
