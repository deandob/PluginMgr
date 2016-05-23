"use strict";

// General FTP helper which sets up session with FTP host and makes directory requests
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
exports.fromHost = function fromHost(channel, scope, data) {
    return "OK"
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
    fw.toHost = function (myChannel, myScope, myData, myLog) { module.parent.exports.toHost(fw.cat, fw.plugName, myChannel, myScope, myData, myLog) };
    fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) {module.parent.exports.addChannel(fw.cat, fw.plugName, name, desc, type, io, min, max, units, attribs, value, store)};
    return startup();
}
