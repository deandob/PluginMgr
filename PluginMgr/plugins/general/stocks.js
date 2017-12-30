"use strict";

// General HTTP helper which sets up session with host for retrieving stocks
var http = require("http");

var started = false;
var stockEntries;
var oldVal = [];

// startup function
function startup() {
    stockEntries = fw.settings.stocklist.split("+");
    return startSession()                   // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

function startSession() {
    try {
        var options = {
            hostname: fw.settings.stockserver,
            port: 80,
            path: fw.settings.stockapi + "?s=" + fw.settings.stocklist + "&f=" + fw.settings.options,
            //headers: {'user-agent': 'Mozilla/5.0'},
            method: 'GET'
        };

        http.get(options, function (res) {
            var csvData = "";
            res.setEncoding('utf8');
            res.on('data', function (chunk) {csvData += chunk;});
            res.on('end', function () {
                                     // Completed retreive CSV file
                var stocks = csvData.split("\n");                           // Get each record
                for (var stock in stocks) {
                    if (stocks[stock] !== "") {
                        var stockFields = stocks[+stock].split(",");               // Get fields
                        if (!started) {                                             // Run first time, create channel with description from CSV returned
                            fw.addChannel(stockEntries[+stock].split(".")[0], stockFields[0].replace(/\"/g, ''), "stock", "output", 0, 1000, "dollars", []);
                        }
                        if (stockFields[1] !== "N/A" && stockFields[1] !== oldVal[+stock]) {            // Send only valid and changed data to host
                            fw.toHost(stockEntries[+stock].split(".")[0], "BUY", stockFields[1]);
                            oldVal[+stock] = stockFields[1];
                        }
                    }
                }
                started = true;
            });
        }).on('error', function (e) {
            console.log("HTTP error: " + e.message);
        });
        setTimeout(startSession, fw.settings.pollinterval * 60000);         // try reconnecting after 3 seconds
        return "OK"
    } catch(err) {
        fw.log("HTTP general connect error: " + err)
        setTimeout(startSession, fw.settings.errortimeout * 60000);         // try reconnecting after 3 seconds
        return err;
    }
}

// Process host messages
function fromHost(channel, scope, data) {
    return "OK"
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
