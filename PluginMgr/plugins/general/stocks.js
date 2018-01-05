"use strict";

// General HTTP helper which sets up session with host for retrieving stocks
var http = require("https");
var stockEntries;
var oldVal = [];

// startup function
function startup() {
    for (var lp in fw.channels) {
        fw.channels[lp].oldval = 0;                                             // Store for old stock value
        fw.channels[lp].lastTrend = "START"
    }
    pollStocks(fw.settings.interval);
    setInterval(pollStocks, fw.settings.interval * 60000, fw.settings.interval);                      // Recurring poll API according to interval
    return "OK"                   // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

function pollStocks(interval) {
    for (var stock in fw.channels) {
        var name = fw.channels[stock].name;
        var path = fw.settings.stockapi + "?function=TIME_SERIES_INTRADAY&symbol=" + name + "&interval=" + interval + "min&apikey=" + fw.settings.key;
        if (fw.channels[stock].attribs[0].name.toUpperCase() === "FX") {
            path = fw.settings.stockapi + "?function=CURRENCY_EXCHANGE_RATE&from_currency=" + name + "&to_currency=" + fw.channels[stock].attribs[0].value + "&apikey=" + fw.settings.key;
        } else {
            if (fw.channels[stock].attribs[0].value.toUpperCase() !== "NASDAQ") name = name + "." + fw.channels[stock].attribs[0].value.toUpperCase();            // Add foreign exhange suffix
        }
        setTimeout(getStock, stock * 1000, name, interval, stock, path);            // Don't swamp the API server, make calls once a second.
    }
}

// Format of Alphavantage JSON:
/* "Meta Data": {
    "1. Information": "Intraday (1min) prices and volumes",
    "2. Symbol": "MSFT",
    "3. Last Refreshed": "2018-01-04 16:00:00",
    "4. Interval": "1min",
    "5. Output Size": "Compact",
    "6. Time Zone": "US/Eastern"
},
"Time Series (1min)": {
    "2018-01-04 16:00:00": {
        "1. open": "87.1150",
        "2. high": "87.1200",
        "3. low": "87.0200",
        "4. close": "87.1100",
        "5. volume": "2412318"
    },
"Time Series (1min)": {
.... */
function getStock(stock, interval, stockIndex, path) {
    try {
        var options = {
            hostname: fw.settings.stockserver,
            port: 443,
            path: path,
            method: 'GET'
        };
        if (fw.settings.debug) fw.log("Polling web service for " + stock + " Path: " + path);

        http.get(options, function (res) {
            var httpData = "";
            res.setEncoding('utf8');
            res.on('data', function (chunk) {httpData += chunk;});
            res.on('end', function () {
                if (fw.settings.debug) fw.log("From API: " + httpData);
                var ret = JSON.parse(httpData);
                if (!ret["Error Message"]) {
                    var list = ret["Time Series (" + interval + "min)"];
                    if (list) {
                        var first;
                        for (var key in list) {
                            first = list[key];                                  // First entry is the latest price
                            break;
                        }
                        if (first) {
                            update(stock, stockIndex, Number(first["4. close"]));
                        } else {
                            fw.log("Format error (Time Series entry) with stock quote for " + stock + ". Data returned: " + httpData);
                        }
                    } else {
                        var exch = ret["Realtime Currency Exchange Rate"];
                        if (exch) {
                                update(stock, stockIndex, Number(exch["5. Exchange Rate"]));
                        } else {
                            fw.log("Format error (Time Series object) with stock quote for " + stock + ". Data returned: " + httpData);
                        }
                    }
                } else {
                    fw.log("Can't retrieve stock quote for " + stock + ", check stock ticker. Error: " + ret["Error Message"]);
                }
            });
        }).on('error', function (e) {
            console.log("HTTP error: " + e.message);
        });
    } catch(err) {
        fw.log("HTTP general connect error: " + err)
        return err;
    }
}

// Format update and send to host
function update(stock, stockIndex, value) {
    var trend = "UNCH";
    if (value !== fw.channels[stockIndex].oldVal) {     // Price change
        if (value > fw.channels[stockIndex].oldVal)
            trend = "INC";
        if (value < fw.channels[stockIndex].oldVal)
            trend = "DEC";
        if (fw.channels[stockIndex].lastTrend = "START")
            trend = "UNCH"                                                          // Trend state is unchanged when first running (don't know previous price)
        fw.toHost(stock, trend, value);
        fw.channels[stockIndex].oldVal = value;
    } else {
        if (fw.channels[stockIndex].lastTrend !== "UNCH") {
            fw.toHost(stock, trend, value);                                        // change trend state even if price is unchanged
        }
    }
    fw.channels[stockIndex].lastTrend = trend;
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
