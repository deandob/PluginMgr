// Node.js plugin code for Advantage Air aircon
"use strict";
var http = require("https");

var pollTimer;
var oldVal = -99;

// Run when plugin initialised
function startup() {
    fw.log("Polling " + fw.settings.host + " every " + fw.settings.pollinterval + " seconds")
    getValues();
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

function setValue(ac, scope, value) {
    switch (scope.toUpperCase()) {
        case "SETTEMP":
            sendCmd(JSON.stringify({ ac: { info: state, value } }));
            break;
    }
}

// Use HTTP post to send commands
function sendCmd(cmdStr) {
    try {
        var options = {
            hostname: fw.settings.host,
            port: fw.settings.port,
            path: fw.settings.command,
            method: 'POST',
            headers: {
                'Content-Length': Buffer.byteLength(cmdStr)
            }
        };

        var httpPost = http.request(options, function (res) {
            if (res.statusCode == "200") {
                var httpData = "";

                res.on('data', function (chunk) { httpData += chunk; });

                res.on('end', function () {                                                     // Completed retreive
                    if (String(fw.settings.debug) === "true") fw.log("Advantage Air command completion result: " + httpData);
                    return;
                });
            } else {
                fw.log("ERROR - Can't send command to Advantage Air, suspect URL is specified incorrectly, check command settings in INI file");
                setTimeout(sendCmd, 5000, cmdStr);  // Keep trying
            }
            res.resume();
        }).on('error', function (e) {
            fw.log("ERROR - HTTP error with sending command: " + e.message + ". Check if IP address " + fw.settings.host + " is correct or if Advantage Air is offline");
            setTimeout(sendCmd, 5000, cmdStr);  // Keep trying
        });
        httpPost.write(cmdStr);
        httpPost.end();
    } catch (err) {
        fw.log("ERROR - HTTP general connect error when sending command. Error: " + err)
    }
}

// Poll gateway API to retrieve sensor values
function getValues() {
    if (fw.settings.debug === true) fw.log("Polling Advantage Air to check latest value...")
    try {
        var options = {
            hostname: fw.settings.host,
            port: fw.settings.port,
            path: fw.settings.getstatus,
            method: 'GET'
        };
        http.get(options, function (res) {
            if (res.statusCode !== 200) fw.log("ERROR - HTTP return code: " + res.statusCode + ". Can't retrieve Advantage Air status, suspect URL is specified incorrectly, check settings in INI file");
            var httpData = "";
            res.on('data', function (chunk) { httpData += chunk; });

            res.on('end', function () {                                                                 // Completed retreive
                var ret = JSON.parse(httpData);
                if (fw.settings.debug === true) fw.log("Advantage Air data returned: " + httpData);
                if (typeof ret.aircons === "undefined") {                                             // Wrong format, some type of error occurred
                    fw.log("ERROR - Wrong data returned from Advantage Air, please check settings: " + httpData);
                } else {
                    for (var ac in ret.aircons) {
                        aircons[ac] = "XX";
                    }
                    if (+ret.aircons[ac].setTemp > (oldVal + Number(fw.settings.changetol)) || +ret.current_power < (oldVal - Number(fw.settings.changetol)))
                        fw.toHost("AIRCON", "W", ret.current_power);                                        // send if change > threshold
                    oldVal = +ret.current_power;
                }
            });
            res.resume();
        }).on('error', function (e) {
            fw.log("ERROR - HTTP error connecting to Advantage Air web server: " + e.message + ". Check if address " + fw.settings.host + " is correct or if service is offline");
        });
    } catch (err) {
        fw.log("ERROR - HTTP general connect error: " + err)
    }
    pollTimer = setTimeout(getValues, +fw.settings.pollinterval * 1000);
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
            fw.log = function (msg) { process.send({ func: "log", cat: fw.cat, name: fw.plugName, log: msg }); };           //TODO: HAVE A LOG STATUS parameter
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

